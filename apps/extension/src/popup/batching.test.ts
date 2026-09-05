import type { DisplayState } from "@mprelist/contracts";
import { describe, expect, it } from "vitest";

import { startBatch, stopBatch, advanceBatch } from "../domain/batch-run";
import { bulkFor, describeProgress, describeSelection, describeStop, rowStatesFor } from "./batching";

/**
 * What the popup makes of a plan's `bulk` flag, and the words it says about a run
 * (T68, #147; ADR-0025).
 *
 * **The cap is the interesting half.** `authorize` sees one ad at a time and has
 * nothing to count a batch with, so *how many at once* is enforced here and
 * nowhere else — which makes this the one place a wrong reading of the entitlement
 * shows up as a user selecting ten ads against two remaining relists and watching
 * eight of them be refused one after another.
 */

const NOW = 1_700_000_000_000;

function planWith(features: Record<string, unknown>, quotaRemaining = 50): DisplayState {
  return {
    subscriptionStatus: "ACTIVE",
    tier: { code: "pro", name: "Pro" },
    quotaRemaining,
    relistQuotaPerPeriod: 50,
    resetAt: "2026-10-01T00:00:00Z",
    features,
  };
}

describe("what a plan lets somebody select", () => {
  it("is what the flag sells, when the period has more than that left", () => {
    expect(bulkFor(planWith({ bulk: { upTo: 10 } }, 50))).toEqual({ cap: 10, upTo: 10 });
  });

  // The quota is the other half of the cap and for a different reason: a selection
  // of ten against two remaining relists is eight ads the gate would refuse one
  // after another, each costing an attempt and a wait.
  it("but the quota where that is the smaller number", () => {
    expect(bulkFor(planWith({ bulk: { upTo: 10 } }, 4))).toEqual({ cap: 4, upTo: 10 });
  });

  // The free tier, which is what draws the boxes disabled beside a line pointing
  // at Plans — a locked control next to somebody's own ads, which is ADR-0007's
  // conversion surface one screen further in.
  it("and nothing at all for a plan that does not include it", () => {
    expect(bulkFor(planWith({}))).toBeNull();
    expect(bulkFor(planWith({ scheduling: true }))).toBeNull();
  });

  // The two values an operator writes when they mean no. The API refuses these
  // too, so a popup that offered the control would be offering something the gate
  // would then refuse ad by ad.
  it("nor for a flag left empty or turned off", () => {
    expect(bulkFor(planWith({ bulk: null }))).toBeNull();
    expect(bulkFor(planWith({ bulk: false }))).toBeNull();
  });

  // The API said yes, which is the half it owns. `{"upTo": N}` is the shape the
  // seed writes rather than one the contract promises, so refusing the feature
  // over a value this screen did not recognise would be second-guessing a
  // permission it did not issue — the quota is then the only cap there is.
  it("but a flag with no readable number is still a grant, capped by the quota", () => {
    expect(bulkFor(planWith({ bulk: true }, 7))).toEqual({ cap: 7, upTo: null });
    expect(bulkFor(planWith({ bulk: { upTo: 0 } }, 7))).toEqual({ cap: 7, upTo: null });
    expect(bulkFor(planWith({ bulk: { upTo: "ten" } }, 7))).toEqual({ cap: 7, upTo: null });
  });
});

describe("what the action bar says", () => {
  it("names how many and how long", () => {
    expect(describeSelection(4).label).toBe("Repost 4 selected · about 2 minutes");
  });

  // Said before the button is pressed, which is the condition ADR-0025 attached to
  // letting a Power batch be twenty-five: a two-hour unattended run is a
  // reasonable thing to choose and an unreasonable thing to discover.
  it("and a full Power batch says two hours before anybody commits to it", () => {
    expect(describeSelection(25).label).toContain("about 2 hours");
  });

  // A separate sentence rather than a longer one: "about 2 hours" alone reads as
  // two hours of work, and what actually happens is a wait in the middle.
  it("and says it will pause when the selection is past the burst rail", () => {
    expect(describeSelection(4).note).toBeNull();
    expect(describeSelection(25).note).toContain("pause");
  });
});

describe("what a run says about itself", () => {
  it("counts the ad it is on while it is going", () => {
    const run = advanceBatch(startBatch(["a", "b", "c"], NOW), { status: "relisted", quota: null }, NOW).run;

    expect(describeProgress(run)).toBe("Reposting 2 of 3…");
  });

  it("and counts what it got through once it is not", () => {
    const run = stopBatch(advanceBatch(startBatch(["a", "b", "c"], NOW), { status: "relisted", quota: null }, NOW).run, "stopped");

    expect(describeProgress(run)).toBe("1 of 3 reposted.");
  });

  // A run that got through its selection needs no explanation — the count is the
  // whole story, and a sentence under it would be an apology for nothing.
  it("and a finished run has nothing to explain", () => {
    expect(describeStop("finished")).toBeNull();
  });

  // Each of these is a different next move, which is why they are separate codes
  // rather than one "it stopped": a quota comes back on a date, a card needs
  // replacing, an ad that is down needs one press of Retry.
  it.each([
    ["quota", "relists for this period"],
    ["dunning", "payment"],
    ["not-in-plan", "isn’t part of your plan"],
    ["unavailable", "Try again"],
    ["ad-down", "Retry"],
    ["failures", "Nothing was removed"],
    ["browser-restart", "Chrome restarted"],
  ] as const)("says something a user can act on about %s", (reason, said) => {
    expect(describeStop(reason)).toContain(said);
  });
});

describe("what the rows show during a run", () => {
  it("marks the ad being attempted as busy and the ones behind it as done", () => {
    const run = advanceBatch(startBatch(["a", "b", "c"], NOW), { status: "relisted", quota: null }, NOW).run;

    expect(rowStatesFor(run)).toEqual({ a: { kind: "done" }, b: { kind: "busy" } });
  });

  // Nothing is busy once the run has stopped, which is what keeps a stopped run
  // from leaving a row spinning forever.
  it("and nothing is busy once it has stopped", () => {
    const run = stopBatch(startBatch(["a", "b"], NOW), "stopped");

    expect(rowStatesFor(run)).toEqual({});
  });

  // The wording is the single-repost wording, because it is the same event — a
  // batch is not a second relist mechanic and should not read like one.
  it("and an ad that is down offers Retry and says where it is", () => {
    const down = advanceBatch(
      startBatch(["a", "b"], NOW),
      { status: "failed-recoverable", listingId: "a", error: new Error("nope"), quota: null },
      NOW,
    ).run;

    expect(rowStatesFor(down)["a"]).toMatchObject({ kind: "failed", action: "retry" });
    expect(rowStatesFor(down)["a"]).toHaveProperty("message", expect.stringContaining("saved in the extension"));
  });

  it("and one that removed nothing says the ad is untouched", () => {
    const skipped = advanceBatch(
      startBatch(["a", "b"], NOW),
      { status: "failed-before-delete", error: new Error("no tab"), quota: null },
      NOW,
    ).run;

    expect(skipped["outcomes"]).toHaveLength(1);
    expect(rowStatesFor(skipped)["a"]).toHaveProperty("message", expect.stringContaining("untouched"));
  });

  it("and nothing at all when there is no run", () => {
    expect(rowStatesFor(null)).toEqual({});
  });
});
