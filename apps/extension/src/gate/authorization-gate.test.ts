import { DENIAL_REASONS, type DenialReason } from "@mprelist/contracts";
import { describe, expect, it } from "vitest";

import { decide, type AuthorizeAttempt, type GateDecision, type LockedState } from "./authorization-gate";

const GRANT = {
  authToken: "a.signed.jwt",
  expiresAt: "2026-08-20T10:00:45.000Z",
  jti: "8b1f0e2a-0c3d-4e5f-9a7b-1c2d3e4f5a6b",
};

const answered = (status: number, body: unknown): AuthorizeAttempt => ({
  kind: "answered",
  status,
  body,
});

/** The locked state of a refusal, or a failure saying it was not one. */
function refusalTo(attempt: AuthorizeAttempt): LockedState {
  const decision = decide(attempt);
  if (decision.decision !== "refuse") throw new Error("expected a refusal, and it proceeded");
  return decision.locked;
}

describe("a fresh 200", () => {
  it("proceeds, carrying the grant through untouched", () => {
    expect(decide(answered(200, GRANT))).toEqual({ decision: "proceed", grant: GRANT });
  });

  it("carries the expiry without judging it", () => {
    // The obvious check — refuse a grant that already expired — would be made
    // against the user's own clock, and under ADR-0007 the user is the adversary:
    // it protects nobody and breaks everyone whose laptop is a few minutes out.
    const longExpired = { ...GRANT, expiresAt: "2020-01-01T00:00:00.000Z" };

    expect(decide(answered(200, longExpired))).toEqual({
      decision: "proceed",
      grant: longExpired,
    });
  });
});

describe("a denial", () => {
  it("locks a failing card behind `update your card`, never an upsell", () => {
    // Since ADR-0018 a cancelled customer falls back to Free and is `active`, so a
    // 402 only ever means dunning. "Resubscribe" would be addressed to somebody
    // who is not there.
    expect(decide(answered(402, { reason: "SUBSCRIPTION_INACTIVE" }))).toEqual({
      decision: "refuse",
      locked: { state: "update-card" },
    });
  });

  it("offers an upgrade, and says when the quota comes back", () => {
    expect(decide(answered(429, { reason: "QUOTA_EXCEEDED", resetAt: "2026-09-14T08:31:22.101Z" }))).toEqual(
      { decision: "refuse", locked: { state: "upgrade", resetAt: "2026-09-14T08:31:22.101Z" } },
    );
  });

  it("shows a cooldown, in the seconds it was given", () => {
    expect(decide(answered(429, { reason: "RATE_LIMITED", retryAfter: 24 }))).toEqual({
      decision: "refuse",
      locked: { state: "cooldown", retryAfter: 24 },
    });
  });

  it("is told apart by its code and not by its status", () => {
    // The contract's own words: the two 429s "are told apart by the code and not
    // by the status". A gate that switched on the status would render a cooldown
    // as an upgrade prompt the day the backend picked a different one.
    expect(refusalTo(answered(402, { reason: "QUOTA_EXCEEDED", resetAt: "2026-09-14T08:31:22.101Z" })))
      .toEqual({ state: "upgrade", resetAt: "2026-09-14T08:31:22.101Z" });
    expect(refusalTo(answered(400, { reason: "RATE_LIMITED", retryAfter: 30 }))).toEqual({
      state: "cooldown",
      retryAfter: 30,
    });
  });

  it("keeps its state when the field that decorates it is missing or the wrong type", () => {
    // The code is the whole of what a client acts on, so a denial without its
    // payload is still that denial — a cooldown with no number is still a cooldown.
    expect(refusalTo(answered(429, { reason: "QUOTA_EXCEEDED" }))).toEqual({
      state: "upgrade",
      resetAt: null,
    });
    expect(refusalTo(answered(429, { reason: "RATE_LIMITED", retryAfter: "30" }))).toEqual({
      state: "cooldown",
      retryAfter: null,
    });
    expect(refusalTo(answered(429, { reason: "RATE_LIMITED", retryAfter: -1 }))).toEqual({
      state: "cooldown",
      retryAfter: null,
    });
  });

  it("has an answer for every code the contract can send", () => {
    // Total over `DenialReason`, so a code added to `@mprelist/contracts` is a
    // *compile* error here rather than a denial that quietly becomes "something
    // went wrong, try again" for a user who could have fixed it in one click.
    const expected: Record<DenialReason, LockedState["state"]> = {
      UNAUTHENTICATED: "retry",
      SUBSCRIPTION_INACTIVE: "update-card",
      BULK_NOT_ENTITLED: "not-in-plan",
      QUOTA_EXCEEDED: "upgrade",
      RATE_LIMITED: "cooldown",
      NO_TIER: "no-tier",
      // Checkout's and the Plan switch's, never a relist's (T83, T85): a gate meeting one has been answered
      // by something that is not the gate, which is the safe reading's case.
      ALREADY_PAYING: "retry",
      NOT_PAYING: "retry",
    };

    for (const reason of DENIAL_REASONS) {
      expect(refusalTo(answered(400, { reason })).state, reason).toBe(expected[reason]);
    }
  });
});

describe("fail-closed", () => {
  const nothingAuthorizes: Array<[string, AuthorizeAttempt]> = [
    ["the backend never answered", { kind: "unreachable" }],
    ["a 200 with no body at all", answered(200, null)],
    ["a 200 that is not an object", answered(200, "OK")],
    ["a 200 missing the token", answered(200, { expiresAt: GRANT.expiresAt, jti: GRANT.jti })],
    ["a 200 missing the reservation", answered(200, { authToken: "t", expiresAt: GRANT.expiresAt })],
    ["a 200 with an empty token", answered(200, { ...GRANT, authToken: "" })],
    ["a 201", answered(201, GRANT)],
    ["a 204", answered(204, null)],
    ["a 401", answered(401, { reason: "UNAUTHENTICATED" })],
    ["a 402", answered(402, { reason: "SUBSCRIPTION_INACTIVE" })],
    ["a 403", answered(403, { reason: "BULK_NOT_ENTITLED" })],
    ["a 429", answered(429, { reason: "QUOTA_EXCEEDED", resetAt: "2026-09-14T08:31:22.101Z" })],
    ["a 500 with an HTML error page", answered(500, "<html>502 Bad Gateway</html>")],
    ["a denial code this build has never heard of", answered(451, { reason: "REGION_BLOCKED" })],
    ["a 4xx that is not a denial and carries nothing", answered(404, null)],
  ];

  it.each(nothingAuthorizes)("does not proceed on %s", (_name, attempt) => {
    // The next thing the caller does on `proceed` is delete somebody's ad. There
    // is no answer worth guessing about.
    expect(decide(attempt).decision).toBe("refuse");
  });

  it("says `retry` for everything the user cannot act on", () => {
    const unactionable: AuthorizeAttempt[] = [
      { kind: "unreachable" },
      answered(200, null),
      answered(204, null),
      answered(401, { reason: "UNAUTHENTICATED" }),
      answered(500, "<html>502 Bad Gateway</html>"),
      answered(451, { reason: "REGION_BLOCKED" }),
      answered(404, null),
    ];

    for (const attempt of unactionable) {
      const decision: GateDecision = decide(attempt);
      expect(decision).toEqual({ decision: "refuse", locked: { state: "retry" } });
    }
  });
});
