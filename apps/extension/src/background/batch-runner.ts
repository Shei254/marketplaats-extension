import {
  advanceBatch,
  isRunning,
  progressOf,
  startBatch,
  stopBatch,
  type BatchRun,
} from "../domain/batch-run";
import type { BatchStore } from "../domain/batch-store";
import type { RelistOutcome } from "../domain/relist-orchestrator";
import type { RelistPacing } from "../domain/relist-pace";

/**
 * The thing that actually runs a batch (T68, #147; ADR-0025) — **in the worker,
 * woken by an alarm, one ad at a time.**
 *
 * **Not in the popup, and that is the whole design.** A Chrome popup is destroyed
 * by any click outside it, so a loop driven from there is a loop that ends when
 * the user looks at something else — mid-relist, with delete-first half executed
 * and one of their ads deleted. Sign-in, Checkout and the relist itself already
 * live in the worker for that reason (ADR-0010, ADR-0017, ADR-0003); this is the
 * fourth.
 *
 * **And not a loop in the worker either.** An MV3 worker is torn down about
 * thirty seconds after it goes idle, and the gaps here are thirty to sixty — so a
 * `setTimeout` between two ads is a run that stops at the first gap. `chrome.alarms`
 * is what wakes the worker back up, which is why the permission is on the manifest
 * and why the pacing window has a floor: alarms are clamped at about thirty
 * seconds in a packed build.
 *
 * The rules about *what happens next* are not here — they are `batch-run.ts`,
 * pure and tested without any of this. What is here is the running of them: the
 * read, the relist, the write, the alarm, and the badge.
 */

/** When to be woken. A port, so a suite can run a whole batch without waiting for one. */
export interface BatchAlarms {
  /** Wake me at this moment. Replaces any wake already asked for. */
  at(when: number): Promise<void>;
  cancel(): Promise<void>;
  /** Whether a wake is still pending — see {@link BatchRunner.ensureScheduled}. */
  pending(): Promise<boolean>;
}

/**
 * The toolbar badge, which is how a closed popup shows progress — and it needs no
 * permission, which is why it is the surface ADR-0025 chose.
 *
 * It is told what is true rather than what to draw: the runner knows a run is
 * going and how many ads are left, and the adapter knows what colour that is.
 */
export interface BatchBadge {
  show(state: "running" | "finished" | "stopped", left: number): Promise<void>;
  clear(): Promise<void>;
}

/** The one thing a run asks of the orchestrator, narrowed to what it uses. */
export interface BatchRelisting {
  relist(listingId: string, batch: boolean): Promise<RelistOutcome>;
}

export interface BatchRunnerDeps {
  store: BatchStore;
  relisting: BatchRelisting;
  /** The **bulk** pacer — the wider window, over the same stored deadline. */
  pace: RelistPacing;
  alarms: BatchAlarms;
  badge: BatchBadge;
  clock?: () => number;
}

export class BatchRunner {
  private readonly clock: () => number;

  /**
   * Everything public here goes through one chain, so two things cannot be
   * folding outcomes into the same run at once — an alarm firing while the popup
   * starts a batch, or a second alarm arriving while the first is still relisting.
   *
   * **It is a guard for one wake and not a lock.** The worker is torn down between
   * ads and this promise goes with it, which is exactly when nothing is in flight
   * anyway; what it protects against is the overlap that can really happen, which
   * is two events in one wake.
   */
  private work: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: BatchRunnerDeps) {
    this.clock = deps.clock ?? (() => Date.now());
  }

  /** The run as it stands, for the popup — including one that has stopped. */
  async state(): Promise<BatchRun | null> {
    return this.serialised(() => this.deps.store.read());
  }

  /**
   * Resolves once nothing this runner started is still in flight.
   *
   * **Nothing in the worker waits on it**, and nothing should: the whole point of
   * the queue is that no caller is holding it. It exists for the two callers who
   * are not the product — a suite that drives a five-ad run in a millisecond
   * rather than four minutes, and the console hook a tester starts one with, where
   * they want the ad to have been attempted before they look at the state.
   *
   * The hook is not named here on purpose: `scripts/build.test.ts` proves those
   * names absent from the production bundle with a text search, and this file is
   * in it.
   */
  async settled(): Promise<void> {
    await this.work;
  }

  /**
   * Start reposting these ads, in this order.
   *
   * **The first ad starts immediately** rather than on an alarm, which is what
   * makes a batch feel like pressing a button: the only thing that can delay it is
   * a deadline a previous relist already wrote, and the pacer waits that out
   * inside the relist itself.
   *
   * A run already going is left alone and answered with. The popup does not offer
   * to start a second, and the honest thing to do about a request it should not
   * have made is not to throw away the first — those ads are mid-flight.
   */
  async start(listingIds: string[]): Promise<BatchRun | null> {
    return this.serialised(async () => {
      const held = await this.deps.store.read();
      if (isRunning(held)) return held;
      if (listingIds.length === 0) return null;

      const run = startBatch(listingIds, this.clock());
      await this.deps.store.write(run);
      await this.badgeFor(run);
      // Not awaited: the caller is a popup waiting for an answer, and the first
      // relist is a capture, a photo fetch, a delete and a create. It would be
      // holding the message channel open for a minute to learn something it is
      // about to poll for anyway.
      void this.next();
      return run;
    });
  }

  /** The alarm went off, which is the only thing that advances a run between ads. */
  async onAlarm(): Promise<void> {
    await this.serialised(() => this.attemptNext());
  }

  /**
   * The user pressed stop.
   *
   * **What is already in flight is not cancelled**, and cannot be: an ad that has
   * been deleted has to be posted again, and abandoning it mid-flow is the one
   * outcome ADR-0003 exists to prevent. So this stops the *queue*, and it waits its
   * turn on the chain to do it — the ad running now finishes and is recorded, and
   * the stop lands on the run that already counts it. What the user gets is
   * "nothing further starts", which is what they asked for.
   */
  async stop(): Promise<BatchRun | null> {
    return this.serialised(async () => {
      const held = await this.deps.store.read();
      if (!isRunning(held)) return held;
      const stopped = stopBatch(held, "stopped");
      await this.deps.store.write(stopped);
      await this.deps.alarms.cancel();
      await this.badgeFor(stopped);
      return stopped;
    });
  }

  /** Forget a run the user has finished reading about, and take the badge with it. */
  async dismiss(): Promise<void> {
    await this.serialised(async () => {
      const held = await this.deps.store.read();
      if (isRunning(held)) return;
      await this.deps.store.clear();
      await this.deps.badge.clear();
    });
  }

  /**
   * The browser has started, so any run still going is **dropped** — the unstarted
   * ads with it (ADR-0025).
   *
   * A deliberate stop and not an absence: `chrome.alarms` persists across
   * sessions, so this run could resume, and resuming it would be delete-first
   * firing at ads nobody has thought about since yesterday. The ads that were
   * never attempted are named on the stop, so the popup can say so and offer to
   * start them again — which is a person pressing a button, and that is the whole
   * difference.
   *
   * ADR-0003's own recovery is untouched and runs beside this: an ad that is
   * *already* deleted is still restored on startup, because putting a listing back
   * is not initiating anything.
   */
  async onBrowserStartup(): Promise<void> {
    await this.serialised(async () => {
      await this.deps.alarms.cancel();
      const held = await this.deps.store.read();
      if (!isRunning(held)) return;
      const dropped = stopBatch(held, "browser-restart");
      await this.deps.store.write(dropped);
      await this.badgeFor(dropped);
    });
  }

  /**
   * On every worker wake: if a run is live and nothing is due to wake it, wake it.
   *
   * **A run that has lost its alarm is a run that has silently ended**, and the
   * ways to lose one are real rather than theoretical — the worker can be killed
   * between writing the run and creating the alarm, and an extension update
   * clears them. There is no state to reconcile and nothing to undo: the queue is
   * a document, and the only thing missing is somebody to come back to it.
   */
  async ensureScheduled(): Promise<void> {
    await this.serialised(async () => {
      const held = await this.deps.store.read();
      if (!isRunning(held)) return;
      if (await this.deps.alarms.pending()) return;
      const due = held.nextAt ?? this.clock();
      if (due <= this.clock()) {
        await this.attemptNext();
        return;
      }
      await this.deps.alarms.at(due);
    });
  }

  /** One ad, then whatever the rules say happens next. */
  private async attemptNext(): Promise<void> {
    const held = await this.deps.store.read();
    if (!isRunning(held)) {
      await this.deps.alarms.cancel();
      return;
    }
    const listingId = held.queued[held.at];
    if (listingId === undefined) {
      // The index is past the end with no stop recorded, which nothing here
      // produces. Written down rather than left to `undefined` reaching the
      // orchestrator as an ad id.
      await this.settle(stopBatch(held, "stopped"));
      return;
    }

    const outcome = await this.deps.relisting.relist(listingId, true);
    const { run, step } = advanceBatch(held, outcome, this.clock());
    if (step.kind === "stop") {
      await this.settle(run);
      return;
    }

    // The longer of the two: what the outcome demands — a `RATE_LIMITED` refusal
    // carries the seconds the rail wants — and what the pacer's own deadline still
    // has left. Taking either alone would be wrong in one direction: the pacer
    // knows nothing about a cooldown, and a cooldown says nothing about the rhythm.
    const gap = Math.max(step.notBeforeMs, await this.deps.pace.msBeforeNextRelist());
    const due = this.clock() + gap;
    const waiting = { ...run, nextAt: due };
    await this.deps.store.write(waiting);
    await this.deps.alarms.at(due);
    await this.badgeFor(waiting);
  }

  private async settle(run: BatchRun): Promise<void> {
    await this.deps.store.write(run);
    await this.deps.alarms.cancel();
    await this.badgeFor(run);
  }

  private async badgeFor(run: BatchRun): Promise<void> {
    const { attempted, total } = progressOf(run);
    if (run.stop === null) {
      await this.deps.badge.show("running", total - attempted);
      return;
    }
    await this.deps.badge.show(run.stop.reason === "finished" ? "finished" : "stopped", run.stop.unstarted.length);
  }

  private serialised<T>(work: () => Promise<T>): Promise<T> {
    const queued = this.work.then(work, work);
    // Swallowed on the chain itself, so one failed step does not reject every
    // later one — the caller still gets the rejection it asked for.
    this.work = queued.catch(() => undefined);
    return queued;
  }

  private async next(): Promise<void> {
    await this.serialised(() => this.attemptNext()).catch((error: unknown) => {
      console.warn("[batch] step failed", error);
    });
  }
}
