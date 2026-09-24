import type { DisplayState } from "@mprelist/contracts";
import { describe, expect, it } from "vitest";

import { grantsNothing, handoffFailure } from "./plans";

/** The subscription somebody is on, as `GET /api/me` describes it. */
const ON: DisplayState = {
  subscriptionStatus: "ACTIVE",
  tier: { code: "free", name: "Gratis" },
  quotaRemaining: 2,
  relistQuotaPerPeriod: 3,
  resetAt: "2026-09-14T08:31:22.101Z",
  features: {},
};

describe("a plan that grants nothing (T32, #41)", () => {
  it("is a grant of 0, and an unlimited one is its opposite", () => {
    // `=== 0` rather than a falsy test, because `null` is unlimited (ADR-0029) and
    // `!quota` reads the two as one plan — the one where nothing may be reposted
    // and the one where everything may.
    expect(grantsNothing({ ...ON, relistQuotaPerPeriod: 0, quotaRemaining: 0 })).toBe(true);
    expect(grantsNothing({ ...ON, relistQuotaPerPeriod: null, quotaRemaining: null })).toBe(false);
    expect(grantsNothing(ON)).toBe(false);
  });

  it("reads the grant and never the remainder, which is the whole of the rule", () => {
    // A spent period is not a plan without reposts: this number goes back up
    // without the holder doing anything, so nothing may be locked on it.
    expect(grantsNothing({ ...ON, quotaRemaining: 0 })).toBe(false);
  });
});

describe("what to say when nothing opened", () => {
  it("tells a buyer their plan is gone and a free user they have niets te beheren", () => {
    // One status, two meanings — which is why the caller says which it asked.
    expect(handoffFailure({ status: "gone" }, "checkout")).toContain("niet meer aangeboden");
    expect(handoffFailure({ status: "gone" }, "portal")).toContain("niets te beheren");
  });

  it("says come back in a moment when Stripe could not be asked", () => {
    expect(handoffFailure({ status: "unavailable" }, "checkout")).toContain("Probeer het zo opnieuw");
    expect(handoffFailure({ status: "unavailable" }, "portal")).toContain("Probeer het zo opnieuw");
  });

  it("has nothing to say about a page that opened, or about a screen change", () => {
    // `signed-out` and `outdated` are screens rather than notes: the popup takes
    // them somewhere else entirely, and a note under the cards would be a second
    // account of one event.
    expect(handoffFailure({ status: "opened", url: "https://stripe.test" }, "checkout")).toBeNull();
    expect(handoffFailure({ status: "signed-out" }, "checkout")).toBeNull();
    expect(handoffFailure({ status: "outdated" }, "portal")).toBeNull();
  });
});
