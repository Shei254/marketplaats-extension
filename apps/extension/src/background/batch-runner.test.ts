import { describe, expect, it } from "vitest";

import { isRunning, type BatchRun } from "../domain/batch-run";
import type { BatchStore } from "../domain/batch-store";
import type { RelistOutcome } from "../domain/relist-orchestrator";
import type { RelistPacing } from "../domain/relist-pace";
import { BatchRunner, type BatchAlarms, type BatchBadge, type BatchRelisting } from "./batch-runner";

/**
 * A whole run, driven the way the browser would drive it — start, alarm, alarm,
 * alarm — with no browser (T68, #147; ADR-0025).
 *
 * **The thing being tested is the wiring, not the rules.** `batch-run.ts` decides
 * what happens after an outcome and has its own suite; what can only go wrong here
 * is the joining up: an alarm that is never set, a run written before the ad it
 * describes was attempted, a stop that leaves a wake-up pending. Each of those is
 * a run that ends silently, which is the failure mode this whole design is built
 * against — a popup-owned loop looks exactly the same from outside.
 *
 * The alarm is a value here rather than a wait, which is what makes a five-ad run
 * a millisecond instead of four minutes.
 */

const NOW = 1_700_000_000_000;
const QUOTA = { quotaRemaining: 5, resetAt: "2026-10-01T00:00:00Z" };

class InMemoryBatchStore implements BatchStore {
  constructor(public held: BatchRun | null = null) {}

  async read(): Promise<BatchRun | null> {
    return this.held;
  }

  async write(run: BatchRun): Promise<void> {
    this.held = run;
  }

  async clear(): Promise<void> {
    this.held = null;
  }
}

/** The wake-ups asked for, as moments — and whether one is still outstanding. */
class RecordedAlarms implements BatchAlarms {
  readonly asked: number[] = [];
  next: number | null = null;

  async at(when: number): Promise<void> {
    this.asked.push(when);
    this.next = when;
  }

  async cancel(): Promise<void> {
    this.next = null;
  }

  async pending(): Promise<boolean> {
    return this.next !== null;
  }
}

class RecordedBadge implements BatchBadge {
  readonly shown: Array<{ state: string; left: number }> = [];
  cleared = 0;

  async show(state: "running" | "finished" | "stopped", left: number): Promise<void> {
    this.shown.push({ state, left });
  }

  async clear(): Promise<void> {
    this.cleared += 1;
  }
}

/** Answers each ad with whatever the test lined up, and records that it was asked. */
class ScriptedRelisting implements BatchRelisting {
  readonly attempted: Array<{ listingId: string; batch: boolean }> = [];

  constructor(private readonly answers: RelistOutcome[]) {}

  async relist(listingId: string, batch: boolean): Promise<RelistOutcome> {
    this.attempted.push({ listingId, batch });
    return this.answers[this.attempted.length - 1] ?? reposted;
  }
}

/** A pacer that says the gap is over unless a test says it is not. */
class SaidPace implements RelistPacing {
  constructor(public leftMs = 0) {}

  async pause(): Promise<void> {}

  async startedRelisting(): Promise<void> {}

  async msBeforeNextRelist(): Promise<number> {
    return this.leftMs;
  }
}

const reposted: RelistOutcome = { status: "relisted", quota: QUOTA };
const removedNothing: RelistOutcome = { status: "failed-before-delete", error: new Error("no tab"), quota: QUOTA };
const adIsDown: RelistOutcome = {
  status: "failed-recoverable",
  listingId: "ad-2",
  error: new Error("create failed"),
  quota: QUOTA,
};

function runner(answers: RelistOutcome[] = [], pace = new SaidPace()) {
  const store = new InMemoryBatchStore();
  const alarms = new RecordedAlarms();
  const badge = new RecordedBadge();
  const relisting = new ScriptedRelisting(answers);
  return {
    store,
    alarms,
    badge,
    relisting,
    pace,
    batch: new BatchRunner({ store, relisting, pace, alarms, badge, clock: () => NOW }),
  };
}

/** Fire the alarm until nothing is waiting for one, which is a run to its end. */
async function untilItStops(fixture: ReturnType<typeof runner>, most = 20): Promise<void> {
  await fixture.batch.settled();
  for (let fired = 0; fired < most && fixture.alarms.next !== null; fired += 1) {
    await fixture.batch.onAlarm();
    await fixture.batch.settled();
  }
}

/**
 * Start a run and wait for its first ad, which the runner deliberately does not
 * hold its caller for — the popup asking for a batch would otherwise be waiting
 * out a capture, a photo fetch, a delete and a create before it heard anything.
 */
async function started(fixture: ReturnType<typeof runner>, listingIds: string[]) {
  const run = await fixture.batch.start(listingIds);
  await fixture.batch.settled();
  return run;
}

describe("starting a run", () => {
  // The first ad starts without waiting for an alarm, which is what makes pressing
  // the button feel like pressing a button — and the alarm's ~30s clamp is exactly
  // what it would have felt like otherwise.
  it("attempts the first ad immediately rather than on an alarm", async () => {
    const fixture = runner();

    await started(fixture, ["ad-1", "ad-2"]);

    expect(fixture.relisting.attempted[0]).toEqual({ listingId: "ad-1", batch: true });
  });

  // Every attempt in a run says it is one, which is the whole of what the API is
  // given to refuse a plan without bulk on.
  it("and says every attempt is part of a batch", async () => {
    const fixture = runner();

    await started(fixture, ["ad-1", "ad-2", "ad-3"]);
    await untilItStops(fixture);

    expect(fixture.relisting.attempted.map((attempt) => attempt.batch)).toEqual([true, true, true]);
  });

  it("works through the selection in the order it was given", async () => {
    const fixture = runner();

    await started(fixture, ["ad-3", "ad-1", "ad-2"]);
    await untilItStops(fixture);

    expect(fixture.relisting.attempted.map((attempt) => attempt.listingId)).toEqual(["ad-3", "ad-1", "ad-2"]);
  });

  // A run already going is not thrown away for a request the popup should not have
  // made: those ads are mid-flight, and the second selection is the one to lose.
  it("leaves a run that is already going alone", async () => {
    const fixture = runner();
    await started(fixture, ["ad-1", "ad-2", "ad-3"]);

    const answered = await fixture.batch.start(["ad-9"]);

    expect(answered?.queued).toEqual(["ad-1", "ad-2", "ad-3"]);
    expect(fixture.relisting.attempted.map((attempt) => attempt.listingId)).not.toContain("ad-9");
  });
});

describe("between two ads", () => {
  // The alarm is the whole design: an MV3 worker is gone thirty seconds after it
  // goes idle and the gap is thirty to sixty, so a run with no wake-up asked for is
  // a run that has silently ended.
  it("asks to be woken for the next one", async () => {
    const fixture = runner([reposted], new SaidPace(45_000));

    await started(fixture, ["ad-1", "ad-2"]);

    expect(fixture.alarms.asked).toEqual([NOW + 45_000]);
  });

  // The pacer says what the rhythm demands and the outcome says what the rail
  // demands, and neither knows about the other — so the wait is the longer of the
  // two. Taking the pacer alone would ignore a cooldown; taking the cooldown alone
  // would repost as fast as the API would let it.
  it("waits for the longer of the pacing gap and whatever the outcome demands", async () => {
    const refusedFor90s: RelistOutcome = { status: "refused", locked: { state: "cooldown", retryAfter: 90 } };
    const fixture = runner([refusedFor90s], new SaidPace(45_000));

    await started(fixture, ["ad-1", "ad-2"]);

    expect(fixture.alarms.asked).toEqual([NOW + 90_000]);
  });

  it("and the run it stores says when that is, so a popup can count it down", async () => {
    const fixture = runner([reposted], new SaidPace(45_000));

    await started(fixture, ["ad-1", "ad-2"]);

    expect(fixture.store.held?.nextAt).toBe(NOW + 45_000);
  });
});

describe("when it ends", () => {
  it("stops asking to be woken", async () => {
    const fixture = runner();

    await started(fixture, ["ad-1", "ad-2"]);
    await untilItStops(fixture);

    expect(fixture.alarms.next).toBeNull();
    expect(isRunning(fixture.store.held)).toBe(false);
  });

  it("and the run it leaves behind says it finished", async () => {
    const fixture = runner();

    await started(fixture, ["ad-1", "ad-2"]);
    await untilItStops(fixture);

    expect(fixture.store.held?.stop).toEqual({ reason: "finished", unstarted: [] });
  });

  // The one that must not be got wrong: an ad is deleted and not back, so the
  // remaining ads are not attempted at all — not one more, not after a wait.
  it("stops at once when an ad is left down, and starts nothing else", async () => {
    const fixture = runner([reposted, adIsDown]);

    await started(fixture, ["ad-1", "ad-2", "ad-3"]);
    await untilItStops(fixture);

    expect(fixture.relisting.attempted.map((attempt) => attempt.listingId)).toEqual(["ad-1", "ad-2"]);
    expect(fixture.store.held?.stop).toEqual({ reason: "ad-down", unstarted: ["ad-3"] });
    expect(fixture.alarms.next).toBeNull();
  });

  it("skips one attempt that removed nothing and stops on the second in a row", async () => {
    const fixture = runner([removedNothing, removedNothing]);

    await started(fixture, ["ad-1", "ad-2", "ad-3", "ad-4"]);
    await untilItStops(fixture);

    expect(fixture.relisting.attempted).toHaveLength(2);
    expect(fixture.store.held?.stop).toEqual({ reason: "failures", unstarted: ["ad-3", "ad-4"] });
  });
});

describe("the badge, which is how a closed popup shows progress", () => {
  it("counts down the ads that are left while a run is going", async () => {
    const fixture = runner();

    await started(fixture, ["ad-1", "ad-2", "ad-3"]);

    expect(fixture.badge.shown.slice(0, 2)).toEqual([
      { state: "running", left: 3 },
      { state: "running", left: 2 },
    ]);
  });

  it("and says so once the run is not going any more", async () => {
    const fixture = runner();

    await started(fixture, ["ad-1"]);
    await untilItStops(fixture);

    expect(fixture.badge.shown.at(-1)).toEqual({ state: "finished", left: 0 });
  });

  it("and a stopped run is not a finished one", async () => {
    const fixture = runner([reposted, adIsDown]);

    await started(fixture, ["ad-1", "ad-2", "ad-3"]);
    await untilItStops(fixture);

    expect(fixture.badge.shown.at(-1)).toEqual({ state: "stopped", left: 1 });
  });

  it("and clearing the run clears it", async () => {
    const fixture = runner();
    await started(fixture, ["ad-1"]);
    await untilItStops(fixture);

    await fixture.batch.dismiss();

    expect(fixture.badge.cleared).toBe(1);
    expect(fixture.store.held).toBeNull();
  });

  // A run still going is not something to dismiss: the badge is the only thing
  // saying it is happening, and clearing the document under the alarm would leave a
  // wake-up for a queue that no longer exists.
  it("but a run that is still going cannot be dismissed", async () => {
    const fixture = runner();
    await started(fixture, ["ad-1", "ad-2"]);

    await fixture.batch.dismiss();

    expect(isRunning(fixture.store.held)).toBe(true);
    expect(fixture.badge.cleared).toBe(0);
  });
});

describe("the user pressing stop", () => {
  it("starts nothing further and cancels the wake-up", async () => {
    const fixture = runner([reposted], new SaidPace(45_000));
    await started(fixture, ["ad-1", "ad-2", "ad-3"]);

    await fixture.batch.stop();

    expect(fixture.alarms.next).toBeNull();
    expect(fixture.store.held?.stop).toEqual({ reason: "stopped", unstarted: ["ad-2", "ad-3"] });
  });

  // And an alarm that was already in flight finds a stopped run and does nothing
  // with it, rather than attempting the ad it was woken for.
  it("and an alarm that arrives afterwards attempts nothing", async () => {
    const fixture = runner();
    await started(fixture, ["ad-1", "ad-2", "ad-3"]);
    await fixture.batch.stop();

    await fixture.batch.onAlarm();

    expect(fixture.relisting.attempted).toHaveLength(1);
  });
});

describe("a browser that has restarted", () => {
  // Alarms persist across sessions, so this run *could* resume. ADR-0025 chose not
  // to, and the reason is not technical: delete-first firing at ads nobody has
  // thought about since yesterday is worse than a run somebody starts again.
  it("drops the ads nobody started and says that is why", async () => {
    const fixture = runner([reposted], new SaidPace(45_000));
    await started(fixture, ["ad-1", "ad-2", "ad-3"]);

    await fixture.batch.onBrowserStartup();

    expect(fixture.store.held?.stop).toEqual({ reason: "browser-restart", unstarted: ["ad-2", "ad-3"] });
    expect(fixture.alarms.next).toBeNull();
  });

  it("and attempts nothing on the way", async () => {
    const fixture = runner();
    await started(fixture, ["ad-1", "ad-2", "ad-3"]);
    const attemptedBefore = fixture.relisting.attempted.length;

    await fixture.batch.onBrowserStartup();

    expect(fixture.relisting.attempted).toHaveLength(attemptedBefore);
  });

  it("but leaves a run that had already finished exactly as it was", async () => {
    const fixture = runner();
    await started(fixture, ["ad-1"]);
    await untilItStops(fixture);

    await fixture.batch.onBrowserStartup();

    expect(fixture.store.held?.stop?.reason).toBe("finished");
  });
});

describe("a run that has lost its wake-up", () => {
  // An extension update clears alarms, and the worker can be killed between
  // writing a run and asking to be woken for it. There is nothing to reconcile —
  // the queue is a document — but without this the run has silently ended.
  it("is picked up again on the next worker wake", async () => {
    const fixture = runner([reposted], new SaidPace(45_000));
    await started(fixture, ["ad-1", "ad-2", "ad-3"]);
    fixture.alarms.next = null;

    await fixture.batch.ensureScheduled();

    expect(fixture.alarms.asked.at(-1)).toBe(NOW + 45_000);
  });

  // And when the moment it was waiting for has already passed — which is what a
  // worker waking hours later finds — it does the ad rather than asking to be woken
  // for a time in the past.
  it("and attempts the next ad when the moment it was waiting for has gone by", async () => {
    const fixture = runner();
    await started(fixture, ["ad-1", "ad-2", "ad-3"]);
    fixture.alarms.next = null;

    await fixture.batch.ensureScheduled();

    expect(fixture.relisting.attempted).toHaveLength(2);
  });

  it("and a run that already has one is left alone", async () => {
    const fixture = runner([reposted], new SaidPace(45_000));
    await started(fixture, ["ad-1", "ad-2"]);
    const askedBefore = fixture.alarms.asked.length;

    await fixture.batch.ensureScheduled();

    expect(fixture.alarms.asked).toHaveLength(askedBefore);
  });

  it("and a stopped run asks for nothing", async () => {
    const fixture = runner();
    await started(fixture, ["ad-1"]);
    await untilItStops(fixture);

    await fixture.batch.ensureScheduled();

    expect(fixture.alarms.next).toBeNull();
  });
});
