import { describe, expect, it } from "vitest";

import { refusalNote, refusedTone, rowStateFor } from "./relisting";

/**
 * The two plans a refusal can land on, named rather than passed as a bare `true`
 * — `refusalNote(locked, true)` at a call site says nothing about what is true.
 */
const GRANTS_NOTHING = true;
const CAPPED = false;

const WIRE_ERROR = { code: "NO_MARKTPLAATS_TAB", message: "No marktplaats.nl tab is open" } as const;

const QUOTA = { quotaRemaining: 1, resetAt: "2026-09-14T08:31:22.101Z" };

describe("what an outcome does to the row", () => {
  it("is done when the ad was reposted", () => {
    expect(rowStateFor({ status: "relisted", quota: QUOTA })).toEqual({ kind: "done" });
  });

  it("offers to start over when nothing was removed", () => {
    // The ad is still there, so the button starts a fresh relist.
    const state = rowStateFor({ status: "failed-before-delete", error: WIRE_ERROR, quota: QUOTA });

    expect(state).toMatchObject({ kind: "failed", tone: "error", action: "relist" });
    expect(state).toHaveProperty("message", expect.stringContaining("je advertentie is ongewijzigd"));
  });

  it("offers to resume when the ad is already gone, and says where it is", () => {
    // The worst thing this product can do to somebody is make their ad vanish
    // with no explanation. The snapshot (ADR-0003) is why it has not, and this
    // sentence is the only place the user is told so.
    const state = rowStateFor({
      status: "failed-recoverable",
      listingId: "m1",
      error: WIRE_ERROR,
      quota: QUOTA,
    });

    expect(state).toMatchObject({ kind: "failed", tone: "warn", action: "retry" });
    expect(state).toHaveProperty("message", expect.stringContaining("opgeslagen in de extensie"));
  });

  it("keeps a refusal apart from a failure", () => {
    // Nothing ran. Rendering it as a failure would tell the user something broke
    // when in fact they were turned away, which is a different next move.
    expect(rowStateFor({ status: "refused", locked: { state: "upgrade", resetAt: null } })).toEqual({
      kind: "refused",
      locked: { state: "upgrade", resetAt: null },
    });
  });

  it("carries the reason each failure came with, whatever it was", () => {
    const state = rowStateFor({ status: "failed-before-delete", error: WIRE_ERROR, quota: QUOTA });

    expect(state).toHaveProperty("message", expect.stringContaining("Open marktplaats.nl in een tabblad"));
  });
});

describe("what a refusal says", () => {
  it("has something for every locked state the gate can produce", () => {
    // One sentence per reason the gate can produce, because a button that
    // silently does nothing is not a state this screen may be in.
    expect(refusalNote({ state: "upgrade", resetAt: null }, CAPPED)).toContain(
      "je limiet voor herplaatsingen",
    );
    expect(refusalNote({ state: "update-card" }, CAPPED)).toContain("betaling");
    // Not the quota sentence: the two end at the same screen and say different
    // things about why you are looking at it.
    expect(refusalNote({ state: "not-in-plan" }, CAPPED)).toContain("bij je abonnement");
    expect(refusalNote({ state: "not-in-plan" }, CAPPED)).not.toContain("je limiet voor herplaatsingen");
    expect(refusalNote({ state: "retry" }, CAPPED)).toContain("Probeer het opnieuw");
  });

  it("counts the seconds when it was given them, and does not invent them when it was not", () => {
    expect(refusalNote({ state: "cooldown", retryAfter: 24 }, CAPPED)).toContain("24s");
    expect(refusalNote({ state: "cooldown", retryAfter: null }, CAPPED)).not.toMatch(/\d/);
  });

  it("tells a plan that grants nothing from one that has been spent (T32, #41)", () => {
    // `upgrade` cannot tell the two apart and is not asked to: a zero-grant tier
    // has a real `resetAt` — the period still rolls, it just rolls to 0 — so the
    // discriminator is display state rather than the denial, and the row reads the
    // grant off `/api/me` the way the strip above it already does.
    const spent = refusalNote({ state: "upgrade", resetAt: "2026-09-14T08:31:22.101Z" }, CAPPED);
    const nothing = refusalNote({ state: "upgrade", resetAt: "2026-09-14T08:31:22.101Z" }, GRANTS_NOTHING);

    expect(spent).toContain("je limiet voor herplaatsingen");
    // The sentence this ticket exists to delete: a limit that was never reached,
    // on a plan where nothing comes back next period either.
    expect(nothing).not.toContain("limiet");
    expect(nothing).toContain("abonnement");
  });

  it("and says the same thing about every other refusal, whatever the grant is", () => {
    // Splitting `upgrade` is a statement about that one reason. A cooldown is the
    // rails, a failing card is Stripe, and neither becomes a different event
    // because the tier grants nothing.
    for (const state of [
      { state: "cooldown", retryAfter: 24 },
      { state: "update-card" },
      { state: "not-in-plan" },
      { state: "retry" },
    ] as const) {
      expect(refusalNote(state, GRANTS_NOTHING)).toBe(refusalNote(state, CAPPED));
    }
  });

  it("shows a clock for a cooldown and a lock for everything else", () => {
    expect(refusedTone({ state: "cooldown", retryAfter: 24 })).toBe("cooldown");
    expect(refusedTone({ state: "upgrade", resetAt: null })).toBe("locked");
    expect(refusedTone({ state: "update-card" })).toBe("locked");
    expect(refusedTone({ state: "not-in-plan" })).toBe("locked");
  });
});
