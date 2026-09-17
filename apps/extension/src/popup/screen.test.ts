import type { DisplayState } from "@mprelist/contracts";
import { describe, expect, it } from "vitest";

import { screenFor } from "./screen";

const PLAN: DisplayState = {
  subscriptionStatus: "ACTIVE",
  tier: { code: "free", name: "Free" },
  quotaRemaining: 3,
  relistQuotaPerPeriod: 3,
  resetAt: "2026-09-14T08:31:22.101Z",
  features: {},
};

describe("which screen an answer means", () => {
  it("shows the plan when there is one", () => {
    expect(screenFor({ status: "ready", plan: PLAN })).toEqual({ screen: "signed-in", plan: PLAN });
  });

  it("shows sign-in when there is no session", () => {
    expect(screenFor({ status: "signed-out" })).toEqual({ screen: "signed-out" });
  });

  it("shows unavailable when nobody could be asked", () => {
    // Never the signed-in screen with stale numbers on it: fail-closed applies to
    // display, and a plan nobody could confirm is the one thing this must not draw.
    expect(screenFor({ status: "unavailable" })).toEqual({ screen: "unavailable" });
  });

  it("shows the update screen for a build the backend has stopped serving", () => {
    // Not `unavailable`, which offers a retry that cannot work (T43, #52).
    expect(screenFor({ status: "outdated" })).toEqual({ screen: "outdated" });
    // T77 (ADR-0032): its own screen for `outdated`'s reason and the opposite of
    // `unavailable` — nothing is down, and no retry changes it.
    expect(screenFor({ status: "no-tier" })).toEqual({ screen: "no-tier" });
  });
});
