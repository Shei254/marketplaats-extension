import type { RemainingQuota } from "@mprelist/contracts";

import type { LockedState } from "../gate/authorization-gate";
import type { RelistOutcome } from "./relist-orchestrator";

/**
 * A batch of reposts as a value: which ads, how far through, and why it stopped
 * (T68, #147; ADR-0025).
 *
 * **Everything here is pure.** The run is a document the worker persists and an
 * alarm advances, but *what the next step is* is arithmetic over the last outcome
 * — and it is the half of this feature that is easiest to get wrong in a way
 * nobody notices: a stopping rule that fires one ad late has already deleted
 * something. So the rules live here, with no storage, no alarms and no clock,
 * and `batch-runner.ts` is the thing that runs them.
 *
 * **Why a queue exists at all.** The popup already relists one ad at a time and
 * locks every other row while one runs (T30b, #79) — not for throughput, but
 * because delete-first (ADR-0003) makes a distracted click on three rows three
 * irreversible deletes. That rule is untouched. What a batch changes is only that
 * something other than a finger presses the button, and the serialisation it was
 * protecting is now the queue itself.
 */

/**
 * Why a run is not still going. Every one of these is a sentence the popup has to
 * be able to say, which is why they are named for the user's situation rather
 * than for the code that produced them — two different denials that mean "your
 * plan" are still two different sentences.
 */
export type BatchStopReason =
  /** Finished: every ad in the selection was attempted. Not a failure. */
  | "finished"
  /** The user pressed stop. */
  | "stopped"
  /**
   * The browser was restarted with ads still unstarted. A **deliberate** stop
   * rather than an absence: alarms persist across sessions, so a run could resume
   * here, and ADR-0025 chose not to — delete-first firing at ads nobody is
   * thinking about is worse than a run that has to be started again.
   */
  | "browser-restart"
  /** `QUOTA_EXCEEDED`. Resolves when the period rolls, which is days. */
  | "quota"
  /** `SUBSCRIPTION_INACTIVE` — a card that is currently failing. Needs a person. */
  | "dunning"
  /** `BULK_NOT_ENTITLED`. The plan stopped including this mid-run, or never did. */
  | "not-in-plan"
  /** The backend could not be reached, or refused with something this build cannot read. */
  | "unavailable"
  /**
   * One of the user's ads is deleted and not back (`failed-recoverable`).
   * <strong>The run stops at once</strong>, which is the strictest rule here:
   * nothing may start a second delete over an unresolved one.
   */
  | "ad-down"
  /**
   * Two consecutive attempts removed nothing and failed anyway. One odd ad should
   * not cost a selection; two in a row is a logged-out session or a moved
   * endpoint, and twenty identical failures over ten minutes is not a run.
   */
  | "failures";

/** What became of one ad in the run, in the order they were attempted. */
export interface BatchAdOutcome {
  listingId: string;
  /**
   * `reposted` spent a unit and the ad has a new id; `skipped` removed nothing
   * and handed its unit back; `down` deleted the ad and could not post it again,
   * which is the one that leaves a snapshot to retry.
   */
  result: "reposted" | "skipped" | "down";
}

export interface BatchStop {
  reason: BatchStopReason;
  /**
   * The ads that were never attempted, which is what the popup offers to repost
   * again. Empty on a run that finished.
   */
  unstarted: string[];
}

/**
 * The run itself — the document `chrome.storage.local` holds and the alarm
 * advances.
 *
 * **`queued` is never edited**, and the position is an index into it. A queue
 * that shifted its own head would make "what did I select" unanswerable the
 * moment anything went wrong, and the popup has to be able to name the ads that
 * did not run.
 */
export interface BatchRun {
  queued: string[];
  /** How many of `queued` have been attempted — so `queued[at]` is next. */
  at: number;
  outcomes: BatchAdOutcome[];
  /** Consecutive attempts that removed nothing. Reset by anything that did. */
  misses: number;
  /** Null while the run is live. */
  stop: BatchStop | null;
  /** When the next ad may start, for a surface that wants to count it down. */
  nextAt: number | null;
  startedAt: number;
  /**
   * What the period has left, as the **last `/complete` answered it** — not a
   * second `/api/me` (T32, #41). It rides on the run because the popup is closed
   * for most of one: the strip that says "2 of 3 relists left" would otherwise
   * show the number it opened with while a run spent four of them, and the first
   * true thing it said would be after the reload at the end.
   *
   * `null` means nobody has been told, which a reader must not treat as
   * unchanged.
   */
  quota: RemainingQuota | null;
}

/** What the runner should do once an outcome has been folded in. */
export type BatchStep =
  | { kind: "stop" }
  /**
   * Attempt `queued[at]` no sooner than this. **A floor and not a schedule** —
   * the pacer has its own opinion about the gap, and the alarm is set to whichever
   * of the two is later. Zero is the ordinary case and means "as soon as the
   * pacing window allows", which for the first ad of a run is immediately.
   */
  | { kind: "next"; notBeforeMs: number };

/** A fresh run over the ads the user ticked, in the order they were given. */
export function startBatch(listingIds: string[], now: number): BatchRun {
  return {
    queued: [...listingIds],
    at: 0,
    outcomes: [],
    misses: 0,
    stop: null,
    nextAt: null,
    startedAt: now,
    quota: null,
  };
}

/** Whether this run is still going, which is the one question three surfaces ask. */
export function isRunning(run: BatchRun | null): run is BatchRun {
  return run !== null && run.stop === null;
}

/** How many ads have been attempted and how many there are, for a progress line. */
export function progressOf(run: BatchRun): { attempted: number; total: number; reposted: number } {
  return {
    attempted: run.at,
    total: run.queued.length,
    reposted: run.outcomes.filter((outcome) => outcome.result === "reposted").length,
  };
}

/** The ads nobody has got to yet — what a stop names and what a finished run has none of. */
export function unstartedIn(run: BatchRun): string[] {
  return run.queued.slice(run.at);
}

/**
 * Fold one attempt into the run, and say what happens next.
 *
 * **The stopping rules are ADR-0025's, and each of them is about the user rather
 * than about the error.** A cooldown is a wait, so the run sleeps it out and tries
 * the same ad again — it was refused before anything happened, so there is nothing
 * to skip. Quota, dunning and an unreachable backend are not waits: they resolve
 * in days, or need a card, or need a person, so the run stops and says which.
 * A `failed-recoverable` stops it at once, because one of the user's ads is down
 * and nothing may start a second delete over an unresolved one. A
 * `failed-before-delete` removed nothing and refunded its unit, so it costs that
 * ad and not the selection — until the second one in a row, which is a
 * logged-out session rather than an odd ad.
 *
 * @param held the run as it stands, with the ad at `queued[at]` just attempted
 * @param outcome what the orchestrator answered for that ad
 * @param now used only to stamp {@link BatchRun.nextAt}; nothing here reads a clock
 */
export function advanceBatch(held: BatchRun, outcome: RelistOutcome, now: number): {
  run: BatchRun;
  step: BatchStep;
} {
  // Kept whatever else happened, and only when there is one: a refusal spent no
  // unit and reports no quota, and `null` there means "we were not told" rather
  // than "there is none left".
  const run = outcome.status === "refused" || outcome.quota === null ? held : { ...held, quota: outcome.quota };
  const listingId = run.queued[run.at] ?? "";

  if (outcome.status === "refused") {
    const wait = cooldownMs(outcome.locked);
    if (wait !== null) {
      // The same ad, later. Nothing reached Marktplaats, so nothing is skipped and
      // the miss count is untouched: a rail refusing the account is not this ad
      // being odd.
      return { run: { ...run, nextAt: now + wait }, step: { kind: "next", notBeforeMs: wait } };
    }
    return stopped(run, stopFor(outcome.locked));
  }

  if (outcome.status === "failed-recoverable") {
    const attempted = took(run, { listingId, result: "down" });
    return stopped({ ...attempted, misses: 0 }, "ad-down");
  }

  if (outcome.status === "failed-before-delete") {
    const attempted = took(run, { listingId, result: "skipped" });
    const missed = { ...attempted, misses: run.misses + 1 };
    return missed.misses >= CONSECUTIVE_MISSES_THAT_STOP_A_RUN
      ? stopped(missed, "failures")
      : nextOrFinished(missed);
  }

  return nextOrFinished({ ...took(run, { listingId, result: "reposted" }), misses: 0 });
}

/**
 * The user stopping it, and the browser restarting under it — the two stops that
 * are not an outcome (ADR-0025).
 *
 * The restart is the one worth naming here rather than treating as a cancel: the
 * unstarted ads are dropped **because delete-first must not fire at ads nobody is
 * thinking about**, not because anything failed, and the popup says so and offers
 * to start them again.
 */
export function stopBatch(run: BatchRun, reason: "stopped" | "browser-restart"): BatchRun {
  return stopped(run, reason).run;
}

/** Two, because one odd ad should not cost a selection and two in a row is a broken session. */
const CONSECUTIVE_MISSES_THAT_STOP_A_RUN = 2;

/**
 * How long a refusal says to wait, or null for one that is not a wait at all.
 *
 * A cooldown carrying no seconds is still a cooldown — the contract is explicit
 * that the code is the whole of what a client acts on and the field only
 * decorates it — so it sleeps the ordinary batch gap rather than giving up on a
 * run over a missing number.
 */
function cooldownMs(locked: LockedState): number | null {
  if (locked.state !== "cooldown") return null;
  return locked.retryAfter === null ? 0 : locked.retryAfter * 1000;
}

function stopFor(locked: LockedState): BatchStopReason {
  switch (locked.state) {
    case "upgrade":
      return "quota";
    case "update-card":
      return "dunning";
    case "not-in-plan":
      return "not-in-plan";
    default:
      // "retry" — the backend could not be reached, or refused with a code this
      // build has never heard of. Fail-closed reads both as "we were turned away",
      // and neither is something a sleep resolves.
      return "unavailable";
  }
}

function took(run: BatchRun, outcome: BatchAdOutcome): BatchRun {
  return { ...run, at: run.at + 1, outcomes: [...run.outcomes, outcome], nextAt: null };
}

function nextOrFinished(run: BatchRun): { run: BatchRun; step: BatchStep } {
  return run.at >= run.queued.length
    ? stopped(run, "finished")
    : { run, step: { kind: "next", notBeforeMs: 0 } };
}

function stopped(run: BatchRun, reason: BatchStopReason): { run: BatchRun; step: BatchStep } {
  return {
    run: { ...run, nextAt: null, stop: { reason, unstarted: unstartedIn(run) } },
    step: { kind: "stop" },
  };
}
