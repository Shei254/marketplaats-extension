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
 * Not here yet, and named so nobody has to guess: `GET /api/client-config` (T27,
 * #36). It is still unbuilt, and a type written ahead of the endpoint it describes
 * is a guess that later reads as a contract.
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
  /**
   * What the tier grants for a whole period — the other half of "2 of 3", and a
   * number that does not move when a unit is spent. A client holding only
   * `quotaRemaining` cannot draw that sentence and ends up keeping a catalog of
   * quotas the API never sends it.
   */
  relistQuotaPerPeriod: number;
  resetAt: string;
  /** The tier's flags as stored. `{}` on every tier today, and sent rather than omitted. */
  features: Record<string, unknown>;
}

/**
 * What a Stripe Price costs, as `GET /api/plans` renders it (T49, #80).
 *
 * **The amount comes from Stripe and is never stored** (ADR-0014/0019): the API
 * caches what Stripe said and holds no second copy of record. A client rendering
 * one is rendering something borrowed.
 */
export interface PlanPrice {
  /**
   * In the currency's smallest unit, as Stripe counts it — 999 is €9.99. Carried
   * as an integer rather than a decimal, because turning it into one is a rounding
   * decision and the place to make it is next to the currency's own rules.
   */
  amount: number;
  /** ISO 4217, lower case, as Stripe writes it. */
  currency: string;
  /** How often it recurs — `month` or `year` in Stripe's vocabulary. */
  interval: string;
}

/**
 * One plan card: our half joined with Stripe's.
 *
 * `maxMarktplaatsAccounts` is deliberately not here. No tier sells more than one
 * until #47 finds a stable Marktplaats account identifier, so a card advertising
 * it would be selling something nothing can yet tell apart.
 */
export interface Plan {
  tier: TierName;
  /** What a period grants, which is the number the card compares plans on. */
  relistQuotaPerPeriod: number;
  /** The tier's flags as stored. `{}` on every tier today, and sent rather than omitted. */
  features: Record<string, unknown>;
  /**
   * **Every rhythm this plan is sold at**, cheapest first — `month` before `year`
   * (T62, #128). One plan, not two: monthly and annual Pro grant the same quota
   * and are the same row, so a card shows the tier once and its prices beside
   * each other.
   *
   * Never empty: a tier with nothing to charge against cannot be published, which
   * the schema holds. A `POST /api/checkout` has to name which of these it means.
   */
  prices: PlanPrice[];
}

/**
 * `GET /api/plans`. **Only what can be bought**: the published tiers carrying a
 * Stripe Price, so the free tier is absent and so is every draft the sync created
 * at quota 0 (ADR-0019).
 *
 * An empty list is an answer — nothing is on sale, which is every stack whose
 * Stripe Prices have not been created yet. It is **not** what a client sees when
 * Stripe could not be reached: that is a `503` with no body at all, rendered as
 * "prices unavailable, retry", because a card whose button opens a Checkout for an
 * amount we guessed is the failure this route is written against.
 */
export interface Plans {
  plans: Plan[];
}

/**
 * `POST /api/checkout` — what the popup asks with when somebody chooses a plan
 * (T19, #29).
 *
 * **The tier code, never a Stripe price id.** `code` is the stable handle
 * ADR-0014 makes the thing anything references, and it is ours to resolve: a
 * client naming a price id could name one we never published.
 */
export interface CheckoutRequest {
  tierCode: string;
  /**
   * Which rhythm to buy — one of the `interval`s on that plan's `prices` (T62,
   * #128). **As required as the code**: a tier may be sold monthly and annually,
   * so naming only the tier names two prices, and a default would charge somebody
   * a rhythm they did not pick. A body without it is a `400`; a rhythm the tier is
   * not sold at is the same `404` an unknown code gets, which is what a client
   * holding yesterday's cards deserves and is nobody's error.
   */
  interval: string;
}

/**
 * Where to send the browser. The popup opens it in a tab and is destroyed the
 * moment that tab takes focus — expected, and the reason `apps/web`'s success page
 * exists to catch the browser (ADR-0017).
 *
 * **A `200` is an offer to pay and not an entitlement.** What moves the plan is
 * Stripe telling us the money did, through the webhook (T20, #30). A client that
 * treated this answer as an upgrade would show a tier the gate is about to refuse.
 *
 * The refusals carry no body: `404` when nothing is on sale under that code — an
 * unknown tier, an unpublished one, or a draft — which is what a client holding
 * yesterday's plan cards gets; `503` when Stripe could not be asked, which is the
 * only one a retry fixes.
 */
export interface CheckoutSession {
  url: string;
}

/**
 * `POST /api/portal` — where "manage billing" becomes a Stripe page (T21, #31).
 *
 * **The request has no body.** Who is asking comes from the token, and everything
 * the Portal offers — the card, the invoices, the cancel button — is configured in
 * Stripe's dashboard rather than named here. It is a `POST` because each call
 * creates a short-lived single-use session, so two calls are two sessions.
 *
 * The popup opens the URL in a tab exactly as it opens a Checkout one, and is
 * destroyed the moment that tab takes focus (ADR-0017). Stripe's own "return" link
 * comes back to `apps/web`, not to `/success` — the commonest reason to be in the
 * Portal is cancelling.
 *
 * **Nothing the user does there is known here until Stripe says so.** A
 * cancellation or a new card reaches this API through the webhook (T20, #30); a
 * client that redrew the plan on returning from the Portal would be guessing.
 *
 * The refusals carry no body: `404` when this account has never been billed, so
 * Stripe holds no customer and there is nothing to manage — the ordinary state of
 * a free user, and the reason a client shows the link only where there is one;
 * `503` when Stripe could not be asked, which is the only one a retry fixes. A
 * subscriber who cancelled is **not** a `404`: ADR-0018 keeps their customer id
 * precisely so their invoices stay reachable.
 */
export interface PortalSession {
  url: string;
}

/**
 * One tier as the operator screens see it (T53, #84) — the whole row, including
 * the parts no other surface is shown.
 *
 * **`stripePriceId` is a fact to read, not a field to edit.** The link between the
 * two systems is the `metadata.tier_code` tag on the Price in Stripe (ADR-0019),
 * so nobody types this id anywhere and it cannot drift. It is `null` on the free
 * tier, which has nothing to charge against, and on a tier whose Price has not
 * been created yet.
 *
 * **No amount, deliberately.** Money is Stripe's, and this screen has to be
 * readable when Stripe is not — an operator locked out of their own catalog during
 * a Stripe outage would be locked out of the one tool that could work around it.
 * `maxMarktplaatsAccounts` is absent too: every tier grants one until #47 finds a
 * stable Marktplaats account identifier, so a column for it would be a form field
 * for a constant.
 */
export interface AdminTier {
  tier: TierName;
  /** What a period grants. Zero is coherent — on the default tier it is "no free tier". */
  relistQuotaPerPeriod: number;
  features: Record<string, unknown>;
  /** Whether a buyer may choose it. False on every draft, and on the free tier for good. */
  published: boolean;
  /** Whether new accounts are provisioned onto it. Exactly one tier carries it. */
  isDefault: boolean;
  /**
   * Every Stripe Price it is sold at, cheapest rhythm first, and empty for a tier
   * sold at none — the free tier, and any whose Price has not been created yet.
   *
   * **Facts to read, never fields to send.** The link between the two systems is
   * the `metadata.tier_code` tag on the Price, so nobody types one of these
   * anywhere. A `PUT` that carried them would be ignored.
   */
  prices: TierPriceOnTheWire[];
}

/** One of the Stripe Prices a tier is sold at, as `/admin` renders it (T62, #128). */
export interface TierPriceOnTheWire {
  stripePriceId: string;
  /** Stripe's vocabulary: `month`, `year`. What tells this price from the tier's others. */
  interval: string;
}

/**
 * `POST /api/admin/tiers/{code}/prices` — a second rhythm for a plan that already
 * exists, and the way a plan is repriced without leaving the screen (T62, #128).
 *
 * **One request for both, because in Stripe they are one act**: create a Price
 * tagged with the tier's code. What decides which happened is whether the tier
 * already has a price at that rhythm — adding lands beside the existing one,
 * repricing replaces it, and **everybody already subscribed keeps the Price they
 * bought**, because that is what Stripe's immutability means.
 *
 * It touches neither the quota nor whether the tier is on sale: a plan that was
 * withdrawn does not come back because a price was added to it.
 *
 * Answers `200` with the updated **AdminTier**, `404` for a code nothing is stored
 * under, and `422` with `{ problem }` carrying Stripe's own words.
 */
export interface NewPrice {
  amount: number;
  currency: string;
  interval: string;
}

/**
 * `GET /api/admin/tiers`. **Every tier there is**, cheapest grant first — including
 * the drafts `GET /api/plans` hides (quota 0, unpublished, created by the sync for
 * a Price nobody has decided about) and the free tier, which is never sellable and
 * is very much editable. An operator who could not see a draft could not act on
 * the one thing the screen exists for.
 */
export interface AdminTiers {
  tiers: AdminTier[];
}

/**
 * `PUT /api/admin/tiers/{code}` — the half of a tier an operator may change.
 *
 * **Whole rather than partial**, which is why it is a `PUT`: every field is stated
 * every time, so there is no "absent or null" question for a reader to answer
 * differently from the next one. A body leaving out `relistQuotaPerPeriod` or
 * `published` is a `400` rather than a default, because guessing either would
 * change a plan nobody asked to change.
 *
 * What is **not** here is the decision (ADR-0019): no amount or interval, because
 * Stripe Prices are immutable and a field called "amount" would be lying about
 * what editing it does; no `stripePriceId`, because the tag on the Price is the
 * only link and a second copy is the one that drifts; no `code`, which is the
 * stable handle everything references; and no `isDefault`, which is a property of
 * the catalog rather than of one row — `PUT /api/admin/tiers/{code}/default` moves
 * it, and there is deliberately no way to ask for a catalog with no default at all.
 *
 * **`409` means one thing**: publishing a tier with nothing to charge against. The
 * way out is Stripe's — create a Price tagged with the tier's code. `404` means no
 * tier is stored under that code. Both carry an empty body, since there is exactly
 * one way for this route to conflict and the status is the whole of the message.
 */
export interface TierEdit {
  name: string;
  relistQuotaPerPeriod: number;
  features: Record<string, unknown>;
  published: boolean;
}

/**
 * A Stripe Price no tier will ever be made from (T53, #84) — one that carries no
 * `metadata.tier_code`.
 *
 * It exists because the failure it reports is silent: ADR-0019 names it in its own
 * consequences, "a missing tag is silent — the Price exists, nothing appears in
 * `/admin`, and the only symptom is absence". Not every one is a mistake, though,
 * which is why the list is shown and never acted on: Stripe accounts hold Prices
 * for one-offs, coupons and experiments, and the operator is the only one who can
 * tell an experiment from a forgotten tag.
 */
export interface UntaggedPrice {
  /** Stripe's id — what to search for in the dashboard, and the only certain field. */
  id: string;
  /** Stripe's own nickname, which is optional and usually unset. */
  nickname: string | null;
  /** In the currency's smallest unit, as Stripe counts it. `0` where Stripe states none. */
  amount: number;
  currency: string;
  /**
   * How often it recurs, or `null` for a one-off — the field that most often says
   * "this was never going to be a plan", since a subscription tier has to recur.
   */
  interval: string | null;
}

/**
 * `GET /api/admin/prices`. **An empty list is the good state** — every Price in the
 * account is tagged — which is why a Stripe that could not be asked is a `503` with
 * no body rather than an empty list: reporting an outage as one would tell an
 * operator their catalog is complete at the moment nobody can check.
 */
export interface UnadoptedPrices {
  prices: UntaggedPrice[];
}

/**
 * `POST /api/admin/plans` — a plan created without leaving `/admin`.
 *
 * **This amends ADR-0019, and only where that decision left room.** It chose
 * "Stripe is where a plan is created" because Stripe Prices are immutable and "a
 * form field labelled amount would be lying about what **editing** it does". That
 * argument is about editing, and it still holds: nothing anywhere lets an amount
 * be changed. Writing one *once*, into the system that owns it, is a different act
 * — and repricing is still done in Stripe, where a new tagged Price repoints the
 * tier through the sync exactly as it always has.
 *
 * **The backend writes no row of its own.** It creates a Stripe Product and a
 * Price tagged `metadata.tier_code`, then calls the same two things the webhook
 * and the edit form already call. The `price.created` Stripe sends moments later
 * finds the row already right and is the no-op it was always documented to be.
 *
 * `409` (empty body) means a tier already exists under that code — adopting it
 * instead would repoint an existing tier's Price, which is right for a webhook and
 * wrong for a button labelled New plan. `422` carries `{ problem }`: Stripe's own
 * words, which are the only thing that says what to change ("amount must be at
 * least 50 cents for usd"). It is deliberately not called `reason` — that is this
 * API's vocabulary for a denial about a *user*, and this is a sentence for an
 * operator.
 */
export interface NewPlan {
  /** The stable handle, and the tag the Price is created with. Must not already exist. */
  tierCode: string;
  name: string;
  /** In the currency's smallest unit, as Stripe counts it. Written once, never editable after. */
  amount: number;
  currency: string;
  /** Stripe's vocabulary: `day`, `week`, `month` or `year`. */
  interval: string;
  relistQuotaPerPeriod: number;
  features: Record<string, unknown>;
  published: boolean;
}

/**
 * `GET /api/admin/currencies` — what **this account** can take money in.
 *
 * Read from Stripe rather than listed anywhere: Stripe supports around a hundred
 * and thirty currencies, this account supports the ones its country spec allows,
 * and the difference is a plan card that renders and a Checkout that fails. A
 * hardcoded list would also go stale the day Stripe adds one.
 *
 * `503` with no body when Stripe could not be asked — a form that cannot find out
 * has to say so rather than offer a guess.
 */
export interface SellableCurrencies {
  /** What the account settles in by default — the option to select first. */
  defaultCurrency: string;
  /** Every currency it may price in, lower case as Stripe writes them. Never empty. */
  supported: string[];
}
