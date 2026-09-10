import { describe, expect, it } from "vitest";

import { ASSUMED_RAILS, describeDuration, estimateBatchMs, sleepsMidRun } from "./batch-estimate";
import { BULK_PACE } from "./relist-pace";

/**
 * How long a selection will take, said before somebody commits to it (T68, #147;
 * ADR-0025).
 *
 * The two numbers that matter are the two the ADR names: **Pro's ten fits one
 * burst window exactly**, so the tier most people are on never sleeps mid-run, and
 * **Power's twenty-five is about two hours** across two burst waits. Those are the
 * assertions below — not because the arithmetic is hard, but because they are the
 * numbers the tier caps were drawn against, and a change to either that did not
 * come with a re-reading of that argument should fail here.
 */

describe("how long a selection takes", () => {
  it("is nothing at all for one ad, which starts immediately", () => {
    expect(estimateBatchMs(1, BULK_PACE, ASSUMED_RAILS)).toBe(0);
    expect(estimateBatchMs(0, BULK_PACE, ASSUMED_RAILS)).toBe(0);
  });

  // Nine gaps at an average of 45 seconds. The rail is not reached, which is the
  // whole point of Pro's cap being the burst limit.
  it("is the gaps alone while a run stays inside the burst rail", () => {
    expect(estimateBatchMs(10, BULK_PACE, ASSUMED_RAILS)).toBe(9 * 45_000);
    expect(sleepsMidRun(10, ASSUMED_RAILS)).toBe(false);
  });

  // The eleventh ad may not be authorized until the first has fallen out of the
  // sliding hour, so it waits — which is the rail modelled the way the API
  // enforces it rather than averaged away.
  it("but the ad past the cap waits for the window to slide past the one it counts from", () => {
    expect(estimateBatchMs(11, BULK_PACE, ASSUMED_RAILS)).toBe(ASSUMED_RAILS.burstWindowMs);
    expect(sleepsMidRun(11, ASSUMED_RAILS)).toBe(true);
  });

  // The number ADR-0025 accepted with its eyes open, and the reason Power's cap is
  // written down as a cost rather than a feature: two burst waits, and any Chrome
  // restart inside them drops what is left.
  it("makes a full Power batch about two hours, across two burst waits", () => {
    const hours = estimateBatchMs(25, BULK_PACE, ASSUMED_RAILS) / (60 * 60_000);

    expect(hours).toBeGreaterThan(1.9);
    expect(hours).toBeLessThan(2.3);
  });

  // A run whose own gaps are wider than the rail never meets it, so the rail costs
  // nothing — `Math.max` rather than an assignment. Worth pinning because getting
  // it wrong adds an hour to a sentence for no reason anybody could find.
  it("and a rail a run is already slower than costs it nothing", () => {
    const slow = { minMs: 120_000, maxMs: 120_000 };
    const tight = { burstLimit: 2, burstWindowMs: 60_000 };

    expect(estimateBatchMs(4, slow, tight)).toBe(3 * 120_000);
  });

  // The served rails replace the built-in ones, which is the entire reason they
  // are served: an operator who drops the cap during an incident changes this
  // sentence with a restart rather than a store release.
  it("and follows the rails it is given rather than the ones this build ships", () => {
    const tighter = { burstLimit: 2, burstWindowMs: 10 * 60_000 };

    expect(estimateBatchMs(3, BULK_PACE, tighter)).toBeGreaterThan(estimateBatchMs(3, BULK_PACE, ASSUMED_RAILS));
  });
});

describe("saying it out loud", () => {
  // Coarse on purpose. The estimate is built on an average gap and a rail that may
  // have moved, so "ongeveer 1 uur 47 minutes" would claim a precision the
  // arithmetic does not have — and somebody deciding whether to start an
  // unattended run is choosing between now and later.
  it.each([
    [0, "minder dan een minuut"],
    [30_000, "minder dan een minuut"],
    [60_000, "ongeveer 1 minuut"],
    [3 * 60_000, "ongeveer 3 minuten"],
    [59 * 60_000, "ongeveer 59 minuten"],
    [2 * 60 * 60_000, "ongeveer 2 uur"],
  ])("says %ims as %s", (ms, said) => {
    expect(describeDuration(ms)).toBe(said);
  });

  // The two sentences the click-through reads back: Pro's four selected ads, and
  // Power's twenty-five.
  it("describes the two runs the tiers were drawn around", () => {
    expect(describeDuration(estimateBatchMs(4, BULK_PACE, ASSUMED_RAILS))).toBe("ongeveer 2 minuten");
    expect(describeDuration(estimateBatchMs(25, BULK_PACE, ASSUMED_RAILS))).toBe("ongeveer 2 uur");
  });
});
