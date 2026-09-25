import type { DisplayState } from "@mprelist/contracts";
import { describe, expect, it } from "vitest";

import { ASSUMED_RAILS } from "../domain/batch-estimate";
import { startBatch, stopBatch, advanceBatch } from "../domain/batch-run";
import { BULK_PACE } from "../domain/relist-pace";
import {
  bulkFor,
  describeCap,
  describeHidden,
  describeProgress,
  describeSelectAll,
  describeSelectAllTick,
  describeStop,
  describeTick,
  offerSelection,
  offerUnstarted,
  pickUpTo,
  rowStatesFor,
} from "./batching";
import { AD_IS_DOWN, AD_UNCHANGED } from "./relisting";

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

function planWith(
  features: Record<string, unknown>,
  quotaRemaining: number | null = 50,
  relistQuotaPerPeriod: number | null = 50,
): DisplayState {
  return {
    subscriptionStatus: "ACTIVE",
    tier: { code: "pro", name: "Pro" },
    quotaRemaining,
    relistQuotaPerPeriod,
    resetAt: "2026-10-01T00:00:00Z",
    features,
    paying: false,
    rhythm: null,
  };
}

/** A plan with no repost cap at all (T73, ADR-0029) — both halves are null together. */
function unlimitedPlanWith(features: Record<string, unknown>): DisplayState {
  return planWith(features, null, null);
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

  // On an unlimited tier the quota is not one of the two numbers any more, so the
  // `min` has one operand and the plan's own number is the whole of the cap
  // (T73, ADR-0029).
  it("and on a tier with no cap it is whatever the flag sells", () => {
    expect(bulkFor(unlimitedPlanWith({ bulk: { upTo: 10 } }))).toEqual({ cap: 10, upTo: 10 });
  });

  // Neither number caps it, and the honest cap is then no number at all — which
  // is arithmetic rather than a sentinel: `Infinity` is right in every comparison
  // this file makes of it, where a large finite stand-in would be a lie that bites
  // at exactly the scale nobody tests at.
  it("and nothing at all where the flag sells no number either", () => {
    expect(bulkFor(unlimitedPlanWith({ bulk: true }))).toEqual({
      cap: Number.POSITIVE_INFINITY,
      upTo: null,
    });
  });
});

describe("what the action bar says", () => {
  const SHAPE = { gap: BULK_PACE, rails: ASSUMED_RAILS };
  const ads = (count: number) => Array.from({ length: count }, (unused, at) => `ad-${at}`);
  /** The offer, or a failure that names what it actually was — never a silent skip. */
  const offered = (count: number, bulk = { cap: 25, upTo: 25 }) => {
    const offer = offerSelection(ads(count), bulk, SHAPE);
    if (offer?.kind !== "repost") throw new Error(`no offer for ${count} ads: ${JSON.stringify(offer)}`);
    return offer;
  };

  it("names how many and how long", () => {
    expect(offered(4).label).toBe("Herplaats 4 geselecteerd · ongeveer 2 minuten");
  });

  // Said before the button is pressed, which is the condition ADR-0025 attached to
  // letting a Power batch be twenty-five: a two-hour unattended run is a
  // reasonable thing to choose and an unreasonable thing to discover.
  it("and a full Power batch says two hours before anybody commits to it", () => {
    expect(offered(25).label).toContain("ongeveer 2 uur");
  });

  /**
   * **The cap moves under a standing selection**, which the boxes cannot catch: a
   * single repost pressed while five rows are ticked spends a unit, and
   * `quotaRemaining` comes back smaller than what is on screen. The rows stay
   * ticked — unticking them for somebody would be worse — so the button counts
   * what it will really start, and the estimate follows it.
   */
  it("and counts what it will actually start when the quota has fallen under it", () => {
    const offer = offered(5, { cap: 2, upTo: 10 });

    expect(offer.label).toBe("Herplaats 2 van 5 geselecteerd · minder dan een minuut");
    expect(offer.listingIds).toEqual(["ad-0", "ad-1"]);
  });

  // Nothing left to spend on the rows that are ticked: the reason rather than a
  // button that would do nothing.
  it("and offers the reason instead of a button when it can start none of them", () => {
    expect(offerSelection(ads(3), { cap: 0, upTo: 10 }, SHAPE)).toEqual({
      kind: "blocked",
      why: "Meer herplaatsingen heb je deze periode niet.",
    });
  });

  it("but nothing at all when nothing is ticked", () => {
    expect(offerSelection([], { cap: 10, upTo: 10 }, SHAPE)).toBeNull();
  });

  // A separate sentence rather than a longer one: "ongeveer 2 uur" alone reads as
  // two hours of work, and what actually happens is a wait in the middle.
  it("and says it will pause when the selection is past the burst rail", () => {
    expect(offered(4).note).toBeNull();
    expect(offered(25).note).toContain("gepauzeerd");
  });
});

describe("what a run says about itself", () => {
  it("counts the ad it is on while it is going", () => {
    const run = advanceBatch(startBatch(["a", "b", "c"], NOW), { status: "relisted", quota: null }, NOW).run;

    expect(describeProgress(run)).toBe("Bezig met herplaatsen 2 van 3…");
  });

  it("and counts what it got through once it is not", () => {
    const run = stopBatch(advanceBatch(startBatch(["a", "b", "c"], NOW), { status: "relisted", quota: null }, NOW).run, "stopped");

    expect(describeProgress(run)).toBe("1 van 3 herplaatst.");
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
    ["quota", "herplaatsingen in deze periode"],
    ["dunning", "betaling"],
    ["not-in-plan", "hoort niet bij je abonnement"],
    ["unavailable", "Probeer het opnieuw"],
    ["ad-down", "Opnieuw"],
    ["failures", "Er is niets verwijderd"],
    ["browser-restart", "Chrome is opnieuw gestart"],
  ] as const)("says something a user can act on about %s", (reason, said) => {
    expect(describeStop(reason)).toContain(said);
  });

  // And it says it in this file's own word (T74, #161). Every other branch of
  // that switch says *herplaatsen* or *herplaatsingen*; this one described the
  // same act as "opnieuw ... geplaatst", which is Marktplaats's name for it and
  // not the product's — the mixture ADR-0029 settles, inside one switch.
  it("and calls the act herplaatsen when it is an ad that stopped the run", () => {
    expect(describeStop("ad-down")).toContain("kon niet worden herplaatst");
    expect(describeStop("ad-down")).not.toContain("opnieuw worden geplaatst");
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

  // The single-repost sentence itself, because it is the same event — a batch is
  // not a second relist mechanic and should not read like one. Asserted as an
  // identity rather than a substring since T74 (#161): these were two copies
  // agreeing by hand, and they stopped, one drifting to "opnieuw plaatsen" while
  // the other said "herplaatsen". What the sentence *says* is `relisting.ts`'s to
  // prove; what this file owes is that it is the same sentence.
  it("and an ad that is down offers Retry and says where it is", () => {
    const down = advanceBatch(
      startBatch(["a", "b"], NOW),
      { status: "failed-recoverable", listingId: "a", error: new Error("nope"), quota: null },
      NOW,
    ).run;

    expect(rowStatesFor(down)["a"]).toMatchObject({ kind: "failed", action: "retry" });
    expect(rowStatesFor(down)["a"]).toHaveProperty("message", AD_IS_DOWN);
  });

  it("and one that removed nothing says the ad is untouched", () => {
    const skipped = advanceBatch(
      startBatch(["a", "b"], NOW),
      { status: "failed-before-delete", error: new Error("no tab"), quota: null },
      NOW,
    ).run;

    expect(skipped["outcomes"]).toHaveLength(1);
    expect(rowStatesFor(skipped)["a"]).toHaveProperty("message", AD_UNCHANGED);
  });

  it("and nothing at all when there is no run", () => {
    expect(rowStatesFor(null)).toEqual({});
  });
});

/**
 * Ticking everything, and the sentence over the list that says how much of it
 * "everything" is.
 *
 * **This is where a cap stops being invisible.** The boxes on their own can only
 * express a limit by refusing to move, and a control that goes dead with no words
 * near it is the shape of a bug — which is exactly what a spent quota looked like
 * before this row existed: every box disabled, nothing ticked, and therefore no
 * action bar and no explanation anywhere on the screen.
 */
describe("ticking as much as the plan allows", () => {
  it("takes them from the top, which is the order they were read in", () => {
    expect(pickUpTo(["a", "b", "c", "d"], 2)).toEqual(["a", "b"]);
  });

  // A short list is not a small cap: a Pro user with two ads gets both, and the
  // header's box has to be *full* at two or it would be saying their click did
  // not work.
  it("and all of them when there are fewer than the cap", () => {
    expect(pickUpTo(["a", "b"], 10)).toEqual(["a", "b"]);
  });

  it("and none at all when there is nothing left to spend", () => {
    expect(pickUpTo(["a", "b"], 0)).toEqual([]);
  });

  // Which of the two numbers ran out decides the sentence, and only one of them is
  // something a bigger plan fixes.
  it("says the plan's number when that is what stopped it", () => {
    expect(describeCap({ cap: 10, upTo: 10 })).toBe("Je abonnement herplaatst er 10 tegelijk.");
  });

  it("and the period's when that is the smaller one", () => {
    expect(describeCap({ cap: 3, upTo: 10 })).toContain("Meer herplaatsingen heb je deze periode niet");
  });

  // Neither ran out, so there is no sentence to say — and saying one would name a
  // number that is not stopping anything.
  it("and nothing at all where neither of them is stopping anything", () => {
    expect(describeCap({ cap: Number.POSITIVE_INFINITY, upTo: null })).toBeNull();
  });

  it("takes every ad when nothing caps the selection", () => {
    expect(pickUpTo(["a", "b", "c"], Number.POSITIVE_INFINITY)).toEqual(["a", "b", "c"]);
  });
});

describe("what the line over the list says", () => {
  it("offers to select all, and says how many that would be", () => {
    expect(describeSelectAll(0, { cap: 10, upTo: 10 }, 40)).toEqual({
      label: "Alles selecteren",
      hint: "10 tegelijk",
    });
  });

  // The quota half of the cap, in the four or five characters this row has left
  // for it — the long form belongs under the button, where there is room.
  it("or how many the period has left, when that is the smaller number", () => {
    expect(describeSelectAll(0, { cap: 3, upTo: 10 }, 40)).toEqual({ label: "Alles selecteren", hint: "3 over" });
  });

  // And no number at all where neither caps: the row would otherwise read
  // "Infinity left", which is the one place an unbounded cap could reach a screen.
  it("and no number at all where nothing caps it", () => {
    const uncapped = { cap: Number.POSITIVE_INFINITY, upTo: null };
    expect(describeSelectAll(0, uncapped, 40)).toEqual({ label: "Alles selecteren", hint: null });
    expect(describeSelectAll(3, uncapped, 40)).toEqual({ label: "3 geselecteerd", hint: null });
  });

  // The count carries the cap once anything is ticked, and the hint gives way to
  // Clear: "3 van 10 geselecteerd" beside "10 tegelijk" is the same number twice in a
  // 360px row.
  it("and counts the selection against the cap once there is one", () => {
    expect(describeSelectAll(3, { cap: 10, upTo: 10 }, 40)).toEqual({
      label: "3 van 10 geselecteerd",
      hint: null,
    });
  });

  // A cap that cannot be met is not a cap the user needs told. Two ads on a plan
  // that reposts ten are two ads, and "2 van 10 geselecteerd" beside a Select all box
  // that is — correctly — full is the screen inventing eight ads nobody has.
  it("but not against a cap the list is too short to reach", () => {
    expect(describeSelectAll(2, { cap: 10, upTo: 10 }, 2)).toEqual({ label: "2 geselecteerd", hint: null });
  });

  // Unless a search is hiding part of the selection, in which case the count is
  // bigger than the list and the cap is exactly what explains it.
  it("and names it again once the count is bigger than the list", () => {
    expect(describeSelectAll(5, { cap: 10, upTo: 10 }, 2)).toEqual({
      label: "5 van 10 geselecteerd",
      hint: null,
    });
  });

  // Except where the cap is unbounded, which is the same route with nothing to
  // name: a search hiding part of an unlimited tier's selection was the one path
  // that reached this line with `Infinity` in hand, and it read "5 of Infinity
  // selected" (T73, ADR-0029).
  it("but never names an unbounded one, however the count outgrew the list", () => {
    expect(describeSelectAll(5, { cap: Number.POSITIVE_INFINITY, upTo: null }, 2)).toEqual({
      label: "5 geselecteerd",
      hint: null,
    });
  });

  // The silent failure this row was added for: a spent quota disabled every box on
  // the screen and put no sentence anywhere near them.
  it("says so outright when the period has nothing left", () => {
    expect(describeSelectAll(0, { cap: 0, upTo: 10 }, 40)).toEqual({
      label: "Alles selecteren",
      hint: "Geen herplaatsingen over",
    });
  });

  // The free tier. The row is drawn inert with the boxes it is about (ADR-0007),
  // and the sentence that explains it is the one pointing at Plans, pinned under
  // the list — saying anything here would be a second answer to a question already
  // answered a few pixels lower.
  it("but nothing at all on a plan that does not include bulk", () => {
    expect(describeSelectAll(0, null, 40)).toEqual({ label: "Alles selecteren", hint: null });
  });
});

/**
 * The ticked ads a search has taken off the screen.
 *
 * A selection survives the box being typed in, which is what makes it possible to
 * build one across two queries — and the price is that some of what is about to be
 * reposted is not visible. Bezig met herplaatsen deletes first (ADR-0003), so that is the one
 * surprise on this screen nobody can undo, and it is never left to be inferred from
 * a count that does not match the boxes.
 */
describe("the part of a selection a search is hiding", () => {
  it("is said, with the plural it needs", () => {
    expect(describeHidden(2)).toContain("2 aangevinkte advertenties staan niet in deze resultaten");
    expect(describeHidden(1)).toContain("1 aangevinkte advertentie staat niet in deze resultaten");
  });

  it("and says they are still going to be reposted", () => {
    expect(describeHidden(3)).toContain("wel herplaatst");
  });

  it("but nothing at all when the list is showing all of them", () => {
    expect(describeHidden(0)).toBeNull();
  });
});

/**
 * What a stopped run offers to do about the ads it never reached.
 *
 * **This is the one way into a run that does not go through the checkboxes**, so
 * it is the one place the cap can be forgotten — and forgetting it is not a
 * cosmetic slip: it starts a queue against a quota that cannot pay for it, and the
 * first ad is deleted before the refusals begin.
 */
describe("the offer a stopped run makes", () => {
  const stoppedWith = (queued: string[], done: number) => {
    let run = startBatch(queued, NOW);
    for (let i = 0; i < done; i += 1) run = advanceBatch(run, { status: "relisted", quota: null }, NOW).run;
    return stopBatch(run, "stopped");
  };

  it("is all the ads it never reached, when the plan can start them all", () => {
    const offer = offerUnstarted(stoppedWith(["a", "b", "c"], 1), { cap: 10, upTo: 10 });

    expect(offer).toEqual({ kind: "repost", listingIds: ["b", "c"], label: "Herplaats de resterende 2", note: null });
  });

  // The bug this exists for: twenty-two leftovers against two remaining relists is
  // twenty refusals and one deleted ad, offered by a button that said it would
  // repost twenty-two.
  it("and only as many as the cap allows, saying so in the button itself", () => {
    const offer = offerUnstarted(stoppedWith(["a", "b", "c", "d"], 0), { cap: 2, upTo: 10 });

    expect(offer).toEqual({
      kind: "repost",
      listingIds: ["a", "b"],
      label: "Herplaats 2 van de resterende 4",
      note: "Meer herplaatsingen heb je deze periode niet.",
    });
  });

  // A dead button with no sentence is the shape of a bug, so what is left when
  // nothing can be started is the reason rather than nothing at all.
  it("and when the period has nothing left, the reason instead of a button", () => {
    expect(offerUnstarted(stoppedWith(["a", "b"], 0), { cap: 0, upTo: 10 })).toEqual({
      kind: "blocked",
      why: "Meer herplaatsingen heb je deze periode niet.",
    });
  });

  it("but nothing at all for a run that finished, or a plan without bulk", () => {
    expect(offerUnstarted(stoppedWith(["a"], 1), { cap: 10, upTo: 10 })).toBeNull();
    expect(offerUnstarted(stoppedWith(["a", "b"], 0), null)).toBeNull();
    expect(offerUnstarted(null, { cap: 10, upTo: 10 })).toBeNull();
  });
});

/**
 * The sentence a box carries for whoever hovers it.
 *
 * The header says the cap out loud before anybody meets it; these are for the
 * person who met it anyway and is holding the pointer over the one control that
 * will not respond. Each reason is a different thing to do next, which is the whole
 * reason they are different sentences.
 */
describe("why a box will or will not tick", () => {
  it("points at the plans when the plan does not include bulk at all", () => {
    expect(describeTick(null, false, false, false)).toContain("betaalde abonnementen");
    expect(describeSelectAllTick(null, false, false, 0)).toContain("betaalde abonnementen");
  });

  it("and says a run is going, which is a wait rather than a limit", () => {
    expect(describeTick({ cap: 10, upTo: 10 }, true, false, false)).toContain("Er loopt een reeks");
    expect(describeSelectAllTick({ cap: 10, upTo: 10 }, true, false, 10)).toContain("Er loopt een reeks");
  });

  // The two halves of the cap are two different next moves — one is fixed by a
  // bigger plan and the other by waiting for the period to roll — so the box that
  // has stopped ticking says which.
  it("and names the number that is biting when the cap is spent", () => {
    expect(describeTick({ cap: 10, upTo: 10 }, false, false, true)).toBe("Je abonnement herplaatst er 10 tegelijk.");
    expect(describeTick({ cap: 2, upTo: 10 }, false, false, true)).toContain("Meer herplaatsingen heb je deze periode niet");
    expect(describeSelectAllTick({ cap: 0, upTo: 10 }, false, false, 0)).toContain("Meer herplaatsingen heb je deze periode niet");
  });

  it("and otherwise says what pressing it would do", () => {
    expect(describeTick({ cap: 10, upTo: 10 }, false, false, false)).toContain("Herplaats deze advertentie");
    expect(describeTick({ cap: 10, upTo: 10 }, false, true, false)).toContain("om hem over te slaan");
    expect(describeSelectAllTick({ cap: 10, upTo: 10 }, false, false, 7)).toBe(
      "Vink de eerste 7 advertenties aan en herplaats ze in één reeks.",
    );
    expect(describeSelectAllTick({ cap: 10, upTo: 10 }, false, true, 7)).toBe("Vink alle rijen uit.");
  });

  // A ticked box is never the one that has run out: the cap is spent on *other*
  // rows, and unticking has to stay available or the cap is a trap.
  it("and a ticked box offers to untick even when the cap is full", () => {
    expect(describeTick({ cap: 3, upTo: 10 }, false, true, true)).toContain("om hem over te slaan");
  });

  it("and counts the one ad on a list of one properly", () => {
    expect(describeSelectAllTick({ cap: 10, upTo: 10 }, false, false, 1)).toContain("de enige advertentie hier");
  });
});
