/**
 * The wire shapes of `docs/enforcement-contract.md`, which is their source of
 * truth — this package restates them in TypeScript so both clients read one
 * definition, and `enforcement.test.ts` holds the restatement to the document and
 * to the API's own enums rather than trusting it.
 *
 * **Dates travel as ISO-8601 strings**, exactly as they arrive. Parsing them into
 * `Date` here would make this package a decoder with an opinion about clocks, and
 * the one thing every consumer does with `resetAt` is render it.
 *
 * Not here yet, and named so nobody has to guess: `GET /api/plans` (T49, #80) and
 * `GET /api/client-config` (T27, #36). Both are still unbuilt, and a type written
 * ahead of the endpoint it describes is a guess that later reads as a contract.
 */

/**
 * Why a call was refused. **The code is the whole of what a client acts on** —
 * never the status, and never the prose. The two `429`s prove the point: they are
 * one statement about HTTP and two different statements about the user, one of
 * whom needs a bigger plan and the other of whom needs a minute.
 */
export const DENIAL_REASONS = [
  /** Not signed in, or a token this API would not take. Answered by the filter chain, for every route. */
  "UNAUTHENTICATED",
  /**
   * A card that is currently failing, and **only** that. Since ADR-0018 a
   * cancelled customer falls back to the free tier and is `active`, so nobody who
   * deliberately ended a subscription ever sees this. That is why the extension
   * renders it as "update your card" and never as "resubscribe".
   */
  "SUBSCRIPTION_INACTIVE",
  /** This period's relists are spent. Carries `resetAt`, which is when they come back. */
  "QUOTA_EXCEEDED",
  /** Too fast for the pacing rails (ADR-0008). Carries `retryAfter`, in whole seconds. */
  "RATE_LIMITED",
] as const;

export type DenialReason = (typeof DENIAL_REASONS)[number];

/**
 * The body of every denial: the code, plus whatever that code adds and nothing
 * else. A code that adds nothing sends nothing — a `402` carrying
 * `"resetAt": null` would invite a client to render a date it does not have.
 */
export type Denial =
  | { reason: "UNAUTHENTICATED" }
  | { reason: "SUBSCRIPTION_INACTIVE" }
  | { reason: "QUOTA_EXCEEDED"; resetAt: string }
  /** Whole seconds, rounded up, named after HTTP's own `Retry-After` and carried in the body rather than the header of that name. */
  | { reason: "RATE_LIMITED"; retryAfter: number };

/** `POST /api/relist/authorize`. Quota and pacing are per user; there is no account id to send. */
export interface AuthorizeRequest {
  adId: string;
}

/**
 * The short-lived, single-use OK the extension must hold before it deletes
 * anything (ADR-0007).
 */
export interface RelistAuthorization {
  /** A JWT the backend signed over `{ sub, adId, jti, exp }` — the half a modified extension cannot mint. */
  authToken: string;
  /** ISO-8601, about 45 seconds out. Beside the token so nobody has to decode a JWT to read it. */
  expiresAt: string;
  /** The reservation this authorization spent, and the handle `/complete` settles or refunds it by. */
  jti: string;
}

/** What the extension reports back about a relist it was authorized for. */
export const RELIST_OUTCOMES = [
  /** Deleted and posted again. The unit is spent, which is what the user got for it. */
  "SUCCESS",
  /** Nothing was removed from Marktplaats, so the unit is handed back. */
  "FAILED_BEFORE_DELETE",
  /** The ad was deleted and the re-create failed. The unit stands: the destructive half happened. */
  "FAILED_AFTER_DELETE",
] as const;

export type RelistOutcomeCode = (typeof RELIST_OUTCOMES)[number];

/** `POST /api/relist/complete`. No token: the `jti` names a row in the backend's own table. */
export interface CompleteRequest {
  jti: string;
  outcome: RelistOutcomeCode;
}

/**
 * What is left of the period, and when it comes back — the same subtraction the
 * gate refuses on, answered by `/complete` so a relist needs no follow-up call.
 * `quotaRemaining` is never negative.
 */
export interface RemainingQuota {
  quotaRemaining: number;
  resetAt: string;
}

/** The seven normalized statuses the backend mirrors Stripe's lifecycle into. */
export const SUBSCRIPTION_STATUSES = [
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
  "CANCELED",
  "UNPAID",
  "INCOMPLETE",
  "INCOMPLETE_EXPIRED",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * A tier in both its spellings. `code` is the stable handle an admin edit never
 * moves; `name` is display text an operator may rewrite at any time — so a client
 * brands a plan by `name` and branches on `code`, and never the other way round.
 */
export interface TierName {
  code: string;
  name: string;
}

/**
 * The body of `GET /api/me`: display state, and display state only. It grants
 * nothing and spends nothing, there is no `jti` and no token in it, and the
 * relist path ignores it completely — a stale `ACTIVE` here cannot cause a relist.
 */
export interface DisplayState {
  subscriptionStatus: SubscriptionStatus;
  tier: TierName;
  quotaRemaining: number;
  resetAt: string;
  /** The tier's flags as stored. `{}` on every tier today, and sent rather than omitted. */
  features: Record<string, unknown>;
}
