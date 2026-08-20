import type { DenialReason, RelistAuthorization } from "@mprelist/contracts";

/**
 * The gate: what the extension does about the backend's answer to
 * `POST /api/relist/authorize`.
 *
 * A pure function over a value — no fetch, no DOM, no Chrome API, no clock. The
 * call itself is T26's (#35), which hands the result here and does what it is
 * told. That split is the point: this is the one place that decides whether an ad
 * gets deleted, and it is decidable in a unit test with no stack running.
 *
 * **Fail-closed is the whole design** (ADR-0007). A relist happens only on a fresh
 * `200` carrying an authorization this code could read. Every other answer, every
 * unreadable one, every network failure and every timeout refuses — because the
 * next thing the caller does on `proceed` is delete somebody's ad (ADR-0002), and
 * there is no undo for having guessed.
 */

/** What came back from the call, before anything has been decided about it. */
export type AuthorizeAttempt =
  /** The backend answered. `body` is whatever was parsed out of it, if anything — including `null`. */
  | { kind: "answered"; status: number; body: unknown }
  /**
   * It did not answer: a network error, a timeout, an aborted request. The cause
   * stays with the caller to log; nothing in a fail-closed state is ever rendered
   * from it, so there is nothing for this function to carry.
   */
  | { kind: "unreachable" };

export type GateDecision =
  | { decision: "proceed"; grant: RelistAuthorization }
  | { decision: "refuse"; locked: LockedState };

/**
 * How a refusal is shown. One state per thing the user can *do* about it — which
 * is why `SUBSCRIPTION_INACTIVE` is "update-card" and not an upsell: since
 * ADR-0018 a cancelled customer falls back to the free tier and is `active`, so a
 * `402` only ever means a card that is currently failing.
 *
 * **The code decides the state; the payload only decorates it.** A denial that
 * arrives without its field is still that denial — the contract is explicit that
 * the code is the whole of what a client acts on — so the decoration is `null`
 * rather than a different decision. A cooldown with no number is still a cooldown.
 */
export type LockedState =
  | { state: "update-card" }
  | { state: "upgrade"; resetAt: string | null }
  | { state: "cooldown"; retryAfter: number | null }
  /** "Unavailable — try again." Nothing the user can fix, and nothing they did wrong. */
  | { state: "retry" };

const REFUSE_AND_RETRY: GateDecision = { decision: "refuse", locked: { state: "retry" } };

export function decide(attempt: AuthorizeAttempt): GateDecision {
  if (attempt.kind === "unreachable") return REFUSE_AND_RETRY;

  // Only a 200 is an authorization. A 201 or a 204 is not this contract's answer,
  // and reading one as a grant would be inventing permission from a status.
  if (attempt.status === 200) {
    const grant = asAuthorization(attempt.body);
    return grant ? { decision: "proceed", grant } : REFUSE_AND_RETRY;
  }

  return { decision: "refuse", locked: lockedBy(attempt.body) };
}

/**
 * The grant, or nothing.
 *
 * `expiresAt` is carried and **not judged**. The obvious-looking check — refuse a
 * grant that is already expired — would be made against the user's own clock, and
 * under ADR-0007 the user is the adversary: it protects nobody (the backend
 * enforces the TTL, and a modified extension would not run this code at all) while
 * breaking every honest user whose laptop is a few minutes out.
 */
function asAuthorization(body: unknown): RelistAuthorization | null {
  if (typeof body !== "object" || body === null) return null;
  const fields = body as Record<string, unknown>;

  const authToken = nonEmptyString(fields["authToken"]);
  const expiresAt = nonEmptyString(fields["expiresAt"]);
  const jti = nonEmptyString(fields["jti"]);
  if (!authToken || !expiresAt || !jti) return null;

  return { authToken, expiresAt, jti };
}

function lockedBy(body: unknown): LockedState {
  const fields = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const reason = fields["reason"];

  switch (reason as DenialReason) {
    case "SUBSCRIPTION_INACTIVE":
      return { state: "update-card" };
    case "QUOTA_EXCEEDED":
      return { state: "upgrade", resetAt: nonEmptyString(fields["resetAt"]) };
    case "RATE_LIMITED":
      return { state: "cooldown", retryAfter: wholeSeconds(fields["retryAfter"]) };
    case "UNAUTHENTICATED":
      // The contract renders this as "unavailable, retry" like any other failure
      // the user cannot act on. T24 (#33) refreshes before this call is made, so a
      // `401` here means the refresh did not help — which is a signed-out state
      // T26 (#35) is the first to be able to do anything about.
      return { state: "retry" };
    default:
      // A code this build has never heard of. Extension releases take days and API
      // deploys take minutes (ADR-0011), so an installed build meeting a newer
      // denial is a certainty rather than an edge case — and the safe reading of
      // one is "we were turned away", never "carry on".
      return { state: "retry" };
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** `retryAfter` is whole seconds. Anything else — a string, a date, `null` — is no number at all. */
function wholeSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
