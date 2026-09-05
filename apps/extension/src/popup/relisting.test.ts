import { describe, expect, it } from "vitest";

import { refusalNote, refusedTone, rowStateFor } from "./relisting";

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
    expect(state).toHaveProperty("message", expect.stringContaining("your ad is untouched"));
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
    expect(state).toHaveProperty("message", expect.stringContaining("saved in the extension"));
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

    expect(state).toHaveProperty("message", expect.stringContaining("Open marktplaats.nl in a tab"));
  });
});

describe("what a refusal says", () => {
  it("has something for every locked state the gate can produce", () => {
    // Provisional copy — the designed prompts are T32 (#41) — but a button that
    // silently does nothing is not an acceptable intermediate state.
    expect(refusalNote({ state: "upgrade", resetAt: null })).toContain("used your relists");
    expect(refusalNote({ state: "update-card" })).toContain("payment");
    // Not the quota sentence: the two end at the same screen and say different
    // things about why you are looking at it.
    expect(refusalNote({ state: "not-in-plan" })).toContain("part of your plan");
    expect(refusalNote({ state: "not-in-plan" })).not.toContain("used your relists");
    expect(refusalNote({ state: "retry" })).toContain("Try again");
  });

  it("counts the seconds when it was given them, and does not invent them when it was not", () => {
    expect(refusalNote({ state: "cooldown", retryAfter: 24 })).toContain("24s");
    expect(refusalNote({ state: "cooldown", retryAfter: null })).not.toMatch(/\d/);
  });

  it("shows a clock for a cooldown and a lock for everything else", () => {
    expect(refusedTone({ state: "cooldown", retryAfter: 24 })).toBe("cooldown");
    expect(refusedTone({ state: "upgrade", resetAt: null })).toBe("locked");
    expect(refusedTone({ state: "update-card" })).toBe("locked");
    expect(refusedTone({ state: "not-in-plan" })).toBe("locked");
  });
});
