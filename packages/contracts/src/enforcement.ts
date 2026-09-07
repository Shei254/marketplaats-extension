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
 * Nothing is named here as missing today. The last one that was — `GET
 * /api/client-config` (T27, #36) — is at the bottom of this file, written when the
 * endpoint was, which is the rule: a type written ahead of the endpoint it
 * describes is a guess that later reads as a contract.
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
  /**
   * A capability the caller's plan does not include was named in the request —
   * today that is `batch` on `POST /api/relist/authorize`, and the flag it asks
   * about is `features.bulk` (ADR-0025).
   *
   * **Above `QUOTA_EXCEEDED` and not below it**, which is the whole reason it is a
   * code of its own. Both point at the plan screen, and only one of them describes
   * what was asked for: a caller who named a capability they do not have should
   * not be answered about a quota they also do not have. It is a `403` because
   * they are authenticated and not permitted — told apart from the resource
   * server's own `403` by the rule the denial shape states, that the presence of
   * `reason` means the gate turned you away.
   *
   * **Declared here ahead of anything that sends it**, which is not this package's
   * habit (see the header) and is deliberate: `docs/enforcement-contract.md` is
   * the source of truth and already denies with it, `enforcement.test.ts` holds
   * this list to that document, and a client meeting a code it has never heard of
   * renders "something went wrong, try again" at a user who could have fixed it in
   * a click. The endpoint that will send it is #147.
   */
  "BULK_NOT_ENTITLED",
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
  /** Adds nothing: what to do about it is the plan screen, which needs no field to find. */
  | { reason: "BULK_NOT_ENTITLED" }
  | { reason: "QUOTA_EXCEEDED"; resetAt: string }
  /** Whole seconds, rounded up, named after HTTP's own `Retry-After` and carried in the body rather than the header of that name. */
  | { reason: "RATE_LIMITED"; retryAfter: number };

/** `POST /api/relist/authorize`. Quota and pacing are per user; there is no account id to send. */
export interface AuthorizeRequest {
  adId: string;
  /**
   * That this ad is one of several the caller is working through (#147, ADR-0025).
   *
   * **Optional, and omitting it means `false`** — which is what keeps every build shipped before the flag
   * existed working against an API that now reads it. A newer build talking to an older API has the field
   * ignored, which the popup's own gate covers.
   *
   * **Stated rather than inferred, because nothing on the other end could infer it.** A batch arrives as N
   * ordinary requests, one at a time, indistinguishable from a fast finger — an `authorize` naming N ads and
   * handing back N grants is foreclosed by the two numbers this contract already fixes, since a grant lives
   * ~45 seconds and the pacing rail refuses a second reservation inside five.
   *
   * What it buys is one refusal: `403 BULK_NOT_ENTITLED` when the plan carries no `features.bulk`. **How many
   * at once is not this field's business** — the API says *whether* and the popup says *how many*.
   */
  batch?: boolean;
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
  /**
   * **What a buyer can pay with**, in Stripe's own spelling — `ideal`, `paypal`,
   * `card`, `sepa_debit` (T65, #137). Read from the Stripe dashboard when the
   * cards are drawn, so the popup renders the setting rather than a second copy
   * of it, and formatted client-side for the reason `currency` and `interval`
   * already are.
   *
   * **Always present, and empty is an ordinary answer.** It means "say nothing"
   * — Stripe could not be asked, or nothing is turned on — and it deliberately
   * does not distinguish those, because a client would do the same thing either
   * way. Unlike a price that could not be fetched it does **not** take the
   * screen with it: the cards are a comparison and this is a line under the
   * title, so an empty list arrives beside a perfectly good `plans`.
   */
  paymentMethods: string[];
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
  /** No currency: the catalog has one (see {@link CatalogCurrency}) and no request may name another. */
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
 * Price per rhythm, each tagged `metadata.tier_code`, then calls the same two
 * things the webhook and the edit form already call. The `price.created` Stripe
 * sends moments later finds the row already right and is the no-op it was always
 * documented to be.
 *
 * **The `201` carries the tier as it actually is**, which is not always everything
 * that was asked for: two rhythms are two Stripe calls with no transaction
 * spanning them, so the annual Price can be refused once the monthly one exists.
 * The plan is then created selling by the month — refusing the lot would be untrue,
 * since that first Price is real and tagged and about to be adopted regardless —
 * and the missing rhythm is added from the tier's own row, which is where Stripe's
 * sentence about it can be read. So a client compares `prices` on the answer with
 * the ones it sent rather than assuming they match.
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
  /** The stable handle, and the tag the Prices are created with. Must not already exist. */
  tierCode: string;
  name: string;
  /**
   * **Every rhythm the plan is to be sold at, stated together** (T66) — a plan
   * sold monthly and annually is created in one submit, as one Stripe Product with
   * a Price each.
   *
   * T62 (#128) made a tier able to hold several prices and left this request
   * carrying one, so the second rhythm was a separate act an operator had to
   * remember — and in between, a plan card offered no choice, which is the choice
   * a buyer is actually making.
   *
   * At least one, and never the same `interval` twice: a rhythm named twice is two
   * answers to one question, and the second would silently replace the first. Each
   * amount is **written once** — Stripe Prices cannot be edited, so repricing is a
   * new Price and everybody already subscribed keeps the one they bought.
   */
  prices: NewPrice[];
  relistQuotaPerPeriod: number;
  features: Record<string, unknown>;
  published: boolean;
}

/**
 * `GET /api/admin/currency` — the one currency this whole catalog is priced in.
 *
 * **Every tier, the same currency** (T63, #129). A plan screen is a comparison and
 * €9,99 against $12.99 is not one a buyer can make without knowing today's rate —
 * so it is not a choice per plan, and since it is not a choice it is not a field on
 * any request. A form shows this; it does not offer it.
 *
 * Read from Stripe — the account's own settlement currency — rather than
 * configured, because the account can only settle in what it settles in, and a
 * setting here would be a second answer whose first symptom is a Price Stripe
 * refuses to create.
 *
 * `503` with no body when Stripe could not be asked, and the form then creates
 * nothing rather than guessing.
 */
export interface CatalogCurrency {
  /** Lower case, as Stripe writes it. */
  currency: string;
}

// --- The client's own configuration (T27, #36) -------------------------------

/**
 * How the extension finds Marktplaats's CSRF token. **Names only** — every mode
 * is a branch that already exists in the extension, and this says which one runs
 * (`docs/internal-api-findings.md`).
 *
 * That is the whole of what makes a served config data rather than code: a mode
 * this list does not name is not a new behaviour anybody can deliver, it is a
 * document the client refuses.
 */
export const CSRF_MODES = [
  /** The token is in a `<meta>` tag on the page, by `name`. */
  "meta",
  /** It is in a cookie the page can read, by `name`. */
  "cookie",
  /** A page is fetched and the token read out of it — what Marktplaats needs today. */
  "fetch",
  /** There is none, and nothing is sent. */
  "none",
] as const;

export type CsrfMode = (typeof CSRF_MODES)[number];

/**
 * Where in a fetched page the token is. **A selector and an attribute, never a
 * pattern**: nothing served is compiled, only compared.
 */
export interface ClientConfigExtractor {
  selector: string;
  attribute: string;
}

/**
 * The CSRF block, **replaced whole or not at all**. The modes carry different
 * fields, so a merge could produce a `none` still holding a `url` — which is a
 * config that says two things.
 */
export interface ClientConfigCsrf {
  mode: CsrfMode;
  /** The request header the token is sent in. */
  header: string;
  /** `meta` and `cookie`: what the tag or the cookie is called. */
  name?: string;
  /** `fetch`: the page to read it out of. Absolute — it decides which origin is asked. */
  url?: string;
  /** `fetch`: where in that page to look. */
  extractor?: ClientConfigExtractor;
}

/** The randomised gap between two relists, in milliseconds (ADR-0008, T46 #54). */
export interface ClientConfigPacing {
  minMs: number;
  maxMs: number;
}

/**
 * `GET /api/client-config` — what the extension should do differently from what
 * it was built to do (ADR-0013).
 *
 * **It is a patch, not a configuration.** Every field is optional and the empty
 * document `{ "schemaVersion": 1 }` is the ordinary answer: the extension's
 * built-in defaults are the configuration, and this says only where an operator
 * has had to depart from them. Nothing is restated in two places, so nothing can
 * drift — and an API that never held the ten endpoint paths cannot serve a stale
 * one.
 *
 * **Strictly data**, which is the ADR's hard constraint and MV3's rule: paths,
 * header names, selectors, numbers. Nothing here is evaluated, compiled or
 * executed by the client — a served value is compared against something or
 * substituted into a URL, and that is all.
 *
 * **`schemaVersion` is the API's, not an operator's.** It names the shape of this
 * document; a client that does not know it ignores the document whole rather than
 * reading half of one it does not understand.
 *
 * Authenticated like every other route here. It is the same document for
 * everybody and carries nothing about anyone, which is not a reason to open a
 * route in an API that is closed by default — the caller is a worker that holds a
 * token, and everything this document configures is behind a sign-in anyway.
 */
export interface ClientConfig {
  schemaVersion: number;
  /**
   * Marktplaats's internal paths, by the extension's own name for each. Keys the
   * client does not know are dropped — an older build must not choke on a name a
   * newer one added.
   */
  endpoints?: Record<string, string>;
  csrf?: ClientConfigCsrf;
  pacing?: ClientConfigPacing;
}
