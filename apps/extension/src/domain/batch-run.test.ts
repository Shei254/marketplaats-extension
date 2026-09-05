import { describe, expect, it } from "vitest";

import {
  advanceBatch,
  isRunning,
  progressOf,
  startBatch,
  stopBatch,
  unstartedIn,
  type BatchRun,
} from "./batch-run";
import type { LockedState } from "../gate/authorization-gate";
import type { RelistOutcome } from "./relist-orchestrator";

/**
 * The rules a run is advanced by (T68, #147; ADR-0025).
 *
 * **These are the assertions worth having.** Everything else about a batch is
 * plumbing that fails loudly — an alarm that does not fire is a run that visibly
 * stops — but a stopping rule that fires one ad late has already deleted
 * something, and nothing on the screen says so until the user goes looking. So
 * each rule below is written as the situation it is about rather than as the
 * status code that produced it.
 */

const NOW = 1_700_000_000_000;
const QUOTA = { quotaRemaining: 7, resetAt: "2026-10-01T00:00:00Z" };

const reposted: RelistOutcome = { status: "relisted", quota: QUOTA };
const removedNothing: RelistOutcome = { status: "failed-before-delete", error: new Error("no tab"), quota: QUOTA };
const adIsDown: RelistOutcome = {
  status: "failed-recoverable",
  listingId: "ad-1",
  error: new Error("create failed"),
  quota: QUOTA,
};

const refused = (locked: LockedState): RelistOutcome => ({ status: "refused", locked });

/** Three ads, nothing attempted — what pressing the button leaves behind. */
function threeAds(): BatchRun {
  return startBatch(["ad-1", "ad-2", "ad-3"], NOW);
}

/** Fold a list of outcomes in, one per ad, and answer with where it ended up. */
function after(run: BatchRun, outcomes: RelistOutcome[]): BatchRun {
  return outcomes.reduce((held, outcome) => advanceBatch(held, outcome, NOW).run, run);
}

describe("a run in progress", () => {
  it("starts on the first ad the user selected, in the order they gave", () => {
    const run = threeAds();

    expect(run.at).toBe(0);
    expect(unstartedIn(run)).toEqual(["ad-1", "ad-2", "ad-3"]);
    expect(isRunning(run)).toBe(true);
  });

  it("moves to the next ad when one is reposted", () => {
    const { run, step } = advanceBatch(threeAds(), reposted, NOW);

    expect(step).toEqual({ kind: "next", notBeforeMs: 0 });
    expect(unstartedIn(run)).toEqual(["ad-2", "ad-3"]);
    expect(run.outcomes).toEqual([{ listingId: "ad-1", result: "reposted" }]);
  });

  // The gap is the pacer's, and this only says "no sooner than now" — which for
  // the first ad of a run is what makes it start immediately.
  it("asks for no delay of its own between two ordinary ads", () => {
    expect(advanceBatch(threeAds(), reposted, NOW).step).toEqual({ kind: "next", notBeforeMs: 0 });
  });

  it("finishes when the last ad has been attempted, which is not a failure", () => {
    const run = after(threeAds(), [reposted, reposted, reposted]);

    expect(run.stop).toEqual({ reason: "finished", unstarted: [] });
    expect(progressOf(run)).toEqual({ attempted: 3, total: 3, reposted: 3 });
  });

  // What the popup renders as "2 of 3 relists left" while the popup is shut for
  // most of a run. It comes from `/complete`'s own answer rather than a second
  // `/api/me`, which is the arrangement T32 (#41) already made for one repost.
  it("carries the quota the last report answered with", () => {
    expect(advanceBatch(threeAds(), reposted, NOW).run.quota).toEqual(QUOTA);
  });

  // A refusal spent no unit and was told nothing, and `null` there means "we were
  // not told" rather than "there is none left" — so the last number that was true
  // is kept rather than blanked.
  it("but keeps the last number it was given when an attempt reports none", () => {
    const spent = advanceBatch(threeAds(), reposted, NOW).run;

    expect(advanceBatch(spent, refused({ state: "cooldown", retryAfter: 30 }), NOW).run.quota).toEqual(QUOTA);
  });
});

describe("a rail that says wait", () => {
  // `RATE_LIMITED` is temporary and the ad was refused before anything happened,
  // so there is nothing to skip: the run sleeps it out and tries the same ad. This
  // is the difference ADR-0025 draws between a wait and a stop.
  it("sleeps the cooldown and tries the same ad again", () => {
    const { run, step } = advanceBatch(threeAds(), refused({ state: "cooldown", retryAfter: 42 }), NOW);

    expect(step).toEqual({ kind: "next", notBeforeMs: 42_000 });
    expect(unstartedIn(run)).toEqual(["ad-1", "ad-2", "ad-3"]);
    expect(run.nextAt).toBe(NOW + 42_000);
    expect(run.outcomes).toEqual([]);
  });

  // A cooldown carrying no number is still a cooldown — the contract is explicit
  // that the code is the whole of what a client acts on. Giving up on a run over a
  // missing field would be reading the decoration as the decision.
  it("and one carrying no seconds is still a wait rather than the end of the run", () => {
    const { run, step } = advanceBatch(threeAds(), refused({ state: "cooldown", retryAfter: null }), NOW);

    expect(step).toEqual({ kind: "next", notBeforeMs: 0 });
    expect(isRunning(run)).toBe(true);
  });

  // The rail refusing the account says nothing about this ad, so a cooldown must
  // not count towards the two-failures rule — otherwise a busy account would stop
  // its own run for being paced.
  it("and does not count towards the failures that stop a run", () => {
    const waited = after(threeAds(), [
      refused({ state: "cooldown", retryAfter: 5 }),
      refused({ state: "cooldown", retryAfter: 5 }),
      refused({ state: "cooldown", retryAfter: 5 }),
    ]);

    expect(isRunning(waited)).toBe(true);
    expect(waited.misses).toBe(0);
  });
});

describe("the refusals that end a run", () => {
  // None of these is a wait: they resolve in days, or need a card, or need a
  // person. A run that slept through any of them would be a queue quietly
  // retrying something that cannot succeed until somebody acts.
  it.each([
    ["a spent quota", { state: "upgrade", resetAt: null } as const, "quota"],
    ["a card that is failing", { state: "update-card" } as const, "dunning"],
    ["a plan without bulk", { state: "not-in-plan" } as const, "not-in-plan"],
    ["a backend that could not be reached", { state: "retry" } as const, "unavailable"],
  ])("stops on %s", (_situation, locked, reason) => {
    const { run, step } = advanceBatch(threeAds(), refused(locked), NOW);

    expect(step).toEqual({ kind: "stop" });
    expect(run.stop).toEqual({ reason, unstarted: ["ad-1", "ad-2", "ad-3"] });
  });

  // The ad that was refused is named among the unstarted ones, because nothing
  // happened to it: the popup offers to repost it with the rest.
  it("and names every ad that never ran, including the one it was refused on", () => {
    const stopped = after(threeAds(), [reposted, refused({ state: "upgrade", resetAt: null })]);

    expect(stopped.stop?.unstarted).toEqual(["ad-2", "ad-3"]);
  });
});

describe("an ad that is down", () => {
  // The strictest rule here. One of the user's ads is deleted and not back, so
  // nothing may start a second delete over an unresolved one — and "at once" means
  // the remaining ads are not attempted at all.
  it("stops the run immediately, whatever is left in the queue", () => {
    const { run, step } = advanceBatch(threeAds(), adIsDown, NOW);

    expect(step).toEqual({ kind: "stop" });
    expect(run.stop).toEqual({ reason: "ad-down", unstarted: ["ad-2", "ad-3"] });
  });

  // It is recorded as attempted rather than left unstarted: the snapshot is held
  // and the row offers Retry, so an offer to repost it again would be the wrong
  // button on an ad that is already half-reposted.
  it("and counts the ad it happened to as attempted, not as one still to come", () => {
    const { run } = advanceBatch(threeAds(), adIsDown, NOW);

    expect(run.outcomes).toEqual([{ listingId: "ad-1", result: "down" }]);
    expect(progressOf(run)).toEqual({ attempted: 1, total: 3, reposted: 0 });
  });
});

describe("an attempt that removed nothing", () => {
  // One odd ad should not cost a selection. The unit was handed back and the ad is
  // untouched, so the run skips it and carries on.
  it("skips that ad and attempts the next", () => {
    const { run, step } = advanceBatch(threeAds(), removedNothing, NOW);

    expect(step).toEqual({ kind: "next", notBeforeMs: 0 });
    expect(run.outcomes).toEqual([{ listingId: "ad-1", result: "skipped" }]);
    expect(unstartedIn(run)).toEqual(["ad-2", "ad-3"]);
  });

  // Two in a row is not two odd ads. It is a logged-out session or a moved
  // endpoint, and twenty identical failures spread over ten minutes is not a run.
  it("but two in a row stop it", () => {
    const stopped = after(threeAds(), [removedNothing, removedNothing]);

    expect(stopped.stop).toEqual({ reason: "failures", unstarted: ["ad-3"] });
  });

  // Consecutive, not cumulative: an account with one bad ad early and one bad ad
  // late is an account with two bad ads, not a broken session.
  it("and one that succeeds in between resets the count", () => {
    const run = after(startBatch(["ad-1", "ad-2", "ad-3", "ad-4"], NOW), [
      removedNothing,
      reposted,
      removedNothing,
    ]);

    expect(isRunning(run)).toBe(true);
    expect(run.misses).toBe(1);
  });
});

describe("the two stops that are not an outcome", () => {
  it("the user pressing stop keeps what has happened and names what has not", () => {
    const stopped = stopBatch(after(threeAds(), [reposted]), "stopped");

    expect(stopped.stop).toEqual({ reason: "stopped", unstarted: ["ad-2", "ad-3"] });
    expect(progressOf(stopped)).toEqual({ attempted: 1, total: 3, reposted: 1 });
  });

  // Alarms persist across sessions, so a run *could* resume here. ADR-0025 chose
  // not to: delete-first firing at ads nobody has thought about since yesterday is
  // worse than a run somebody has to start again. The reason is its own, because
  // the popup has a different sentence for it and an offer to repost the rest.
  it("a browser restart drops the ads nobody started, and says that is why", () => {
    const dropped = stopBatch(after(threeAds(), [reposted]), "browser-restart");

    expect(dropped.stop).toEqual({ reason: "browser-restart", unstarted: ["ad-2", "ad-3"] });
    expect(isRunning(dropped)).toBe(false);
  });
});
