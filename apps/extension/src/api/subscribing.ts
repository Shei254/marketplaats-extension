import type { Plan } from "@mprelist/contracts";

import type { Http } from "../auth/discovery";
import { DEFAULT_API_CONFIG, type ApiConfig } from "./api-config";
import { clientHeaders } from "./client-release";
import type { AccessTokens } from "./display-state";

/**
 * The three routes subscribing is made of (T52, #83): what is on sale
 * (`GET /api/plans`, T49 #80), where a plan card becomes a payment
 * (`POST /api/checkout`, T19 #29), and where somebody manages what they already
 * pay for (`POST /api/portal`, T21 #31).
 *
 * Its own file rather than three more methods on `MprelistApi`, for the reason
 * `relist-authorizations.ts` is its own: that one is the snapshot the popup opens
 * with, asked on every open and never spending anything, and these are the calls
 * that only happen when somebody is deciding to pay. One class per thing the
 * backend is asked about, each with the same three dependencies.
 *
 * **Every answer is a value, never a throw.** The popup has a screen for each of
 * them and no screen for an exception — and the two failures here are not the same
 * failure: a plan that is no longer on sale is nobody's error and a client holding
 * yesterday's cards gets it, while a Stripe that could not be reached is the one
 * worth a retry button. `docs/enforcement-contract.md` gives them separate statuses
 * for exactly that reason, so collapsing them here would throw the distinction away
 * one layer after it was made.
 */
export type PlansAnswer =
  | { status: "ready"; plans: Plan[]; paymentMethods: string[] }
  | { status: "signed-out" }
  | { status: "outdated" }
  | { status: "unavailable" };

/**
 * What came of asking for a Stripe page to send the browser to — a Checkout
 * session or a Customer Portal one, which answer the same four ways.
 *
 * `gone` is the `404` both routes have and it means something different on each:
 * for Checkout, nothing is on sale under that code any more; for the Portal, this
 * account has never been billed, so Stripe holds no customer for it. Neither is an
 * error and both are ordinary, so the wording is the caller's — it knows which
 * question it asked, and this does not have to hold two vocabularies to tell it.
 */
export type HandoffAnswer =
  | { status: "opened"; url: string }
  | { status: "gone" }
  | { status: "signed-out" }
  | { status: "outdated" }
  | { status: "unavailable" };

export interface SubscribingDeps {
  tokens: AccessTokens;
  config?: ApiConfig;
  http?: Http;
}

export class Subscribing {
  private readonly config: ApiConfig;
  private readonly http: Http;

  constructor(private readonly deps: SubscribingDeps) {
    this.config = deps.config ?? DEFAULT_API_CONFIG;
    this.http = deps.http ?? ((url, init) => fetch(url, init));
  }

  /**
   * The plans somebody can actually buy. **The free tier is not among them and
   * neither is any draft** — the route answers only what carries a Stripe Price
   * and is published, which is what makes an unbuyable card impossible here
   * rather than filtered out here (ADR-0019).
   *
   * An empty list is an answer and not a failure: nothing is on sale, which is
   * true of every stack whose Stripe Prices have not been created yet (T22, #28).
   * A `503` is the different thing, and the screen says so.
   */
  async plans(): Promise<PlansAnswer> {
    const token = await this.deps.tokens.accessToken();
    if (token.status !== "ready") return { status: token.status };

    let response: Response;
    try {
      response = await this.http(`${this.config.baseUrl}/api/plans`, {
        headers: {
          authorization: `Bearer ${token.token}`,
          accept: "application/json",
          ...clientHeaders(),
        },
      });
    } catch {
      return UNAVAILABLE;
    }

    if (response.status === 401) return { status: "signed-out" };
    if (response.status === 426) return { status: "outdated" };
    if (!response.ok) return UNAVAILABLE;

    const body = await response.json().catch(() => null);
    const plans = asPlans(body);
    // Read separately, and that separation is the point (T65, #137): the cards are
    // refused whole if one field is wrong, and the ways to pay cannot take them with
    // them. A malformed `paymentMethods` costs the sentence under the title.
    return plans ? { status: "ready", plans, paymentMethods: asPaymentMethods(body) } : UNAVAILABLE;
  }

  /**
   * Turn a tier code into a Stripe Checkout URL.
   *
   * **The code and the rhythm, never a price id** — the code is the stable handle
   * ADR-0014 makes the thing anything references, and resolving it is the
   * backend's, which is what stops a client naming a Price nobody published. The
   * rhythm is as required as the code since T62 (#128): a tier may be sold monthly
   * and annually, so the code alone names two prices.
   *
   * A `200` is an offer to pay and **not** an entitlement: what moves the plan is
   * Stripe telling the backend the money did, through the webhook (T20, #30). So
   * nothing here or above it redraws a plan on the strength of this answer.
   */
  async checkout(tierCode: string, interval: string): Promise<HandoffAnswer> {
    return this.handoff("/api/checkout", JSON.stringify({ tierCode, interval }));
  }

  /**
   * Turn a session into a Stripe Customer Portal URL — the card, the invoices and
   * cancelling, all of them Stripe's own pages (ADR-0006).
   *
   * **No body**, because there is nothing to say: who is asking comes from the
   * token, and what the Portal offers is configured in Stripe's dashboard.
   */
  async portal(): Promise<HandoffAnswer> {
    return this.handoff("/api/portal", undefined);
  }

  /**
   * The shape both share: a POST with a token on it, and a URL back.
   *
   * The body is passed already serialised because one of the two has none at all,
   * and `JSON.stringify(undefined)` is `undefined` rather than an empty
   * body — a difference that would send `Content-Type: application/json` with
   * nothing after it, which is a request the backend is entitled to refuse.
   */
  private async handoff(path: string, body: string | undefined): Promise<HandoffAnswer> {
    const token = await this.deps.tokens.accessToken();
    if (token.status !== "ready") return { status: token.status };

    let response: Response;
    try {
      response = await this.http(`${this.config.baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token.token}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...clientHeaders(),
        },
        ...(body === undefined ? {} : { body }),
      });
    } catch {
      return UNAVAILABLE;
    }

    if (response.status === 401) return { status: "signed-out" };
    if (response.status === 426) return { status: "outdated" };
    if (response.status === 404) return { status: "gone" };
    if (!response.ok) return UNAVAILABLE;

    const url = urlIn(await response.json().catch(() => null));
    return url ? { status: "opened", url } : UNAVAILABLE;
  }
}

const UNAVAILABLE = { status: "unavailable" } as const;

/**
 * The plans, checked rather than trusted — every field of every card, and the
 * whole list is refused if one of them is wrong.
 *
 * **All of them or none of them**, which is the rule the route itself keeps for a
 * price it could not fetch and the same argument applies here: a plan screen is a
 * comparison, and a buyer cannot tell a card that is missing from a plan that does
 * not exist. A half-read list is the worse version of that, because the card that
 * survived would look complete.
 */
export function asPlans(body: unknown): Plan[] | null {
  if (typeof body !== "object" || body === null) return null;
  const plans = (body as Record<string, unknown>)["plans"];
  if (!Array.isArray(plans)) return null;

  const read: Plan[] = [];
  for (const entry of plans) {
    const plan = asPlan(entry);
    if (!plan) return null;
    read.push(plan);
  }
  return read;
}

function asPlan(entry: unknown): Plan | null {
  if (typeof entry !== "object" || entry === null) return null;
  const fields = entry as Record<string, unknown>;

  const tier = asTier(fields["tier"]);
  if (!tier) return null;

  // `null` is a tier with no cap (T73, ADR-0029), and it is the only other thing
  // this number can be on a card: a published tier granting nothing is a row the
  // schema refuses, so `0` never reaches a plan screen.
  const relistQuotaPerPeriod = fields["relistQuotaPerPeriod"];
  if (
    relistQuotaPerPeriod !== null &&
    (typeof relistQuotaPerPeriod !== "number" ||
      !Number.isInteger(relistQuotaPerPeriod) ||
      relistQuotaPerPeriod < 0)
  ) {
    return null;
  }

  const features = fields["features"];
  if (typeof features !== "object" || features === null || Array.isArray(features)) return null;

  const prices = asPrices(fields["prices"]);
  if (!prices) return null;

  return { tier, relistQuotaPerPeriod, features: features as Record<string, unknown>, prices };
}

function asTier(value: unknown): Plan["tier"] | null {
  if (typeof value !== "object" || value === null) return null;
  const { code, name } = value as Record<string, unknown>;
  if (typeof code !== "string" || code.length === 0) return null;
  if (typeof name !== "string" || name.length === 0) return null;
  return { code, name };
}

/**
 * The amount, the currency and how often it recurs.
 *
 * `amount` is in the currency's smallest unit as Stripe counts it — 999 is €9,99 —
 * so it is an integer and a fractional one is a card that would be drawn wrong
 * rather than a card that is nearly right. **Zero is allowed**: a Price of 0 is a
 * thing Stripe can hold, and refusing it here would blank a plan screen over a
 * plan somebody deliberately made free.
 */
/**
 * Every rhythm a plan is sold at (T62, #128), and **never an empty list**: a tier
 * with nothing to charge against cannot be published, so a card with no price is a
 * card whose only button could not open a Checkout.
 */
function asPrices(value: unknown): Plan["prices"] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const read: Plan["prices"] = [];
  for (const entry of value) {
    const price = asPrice(entry);
    if (!price) return null;
    read.push(price);
  }
  return read;
}

function asPrice(value: unknown): Plan["prices"][number] | null {
  if (typeof value !== "object" || value === null) return null;
  const { amount, currency, interval } = value as Record<string, unknown>;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) return null;
  if (typeof currency !== "string" || currency.length === 0) return null;
  if (typeof interval !== "string" || interval.length === 0) return null;
  return { amount, currency, interval };
}

/** The one field both `CheckoutSession` and `PortalSession` carry. */
function urlIn(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const url = (body as Record<string, unknown>)["url"];
  return typeof url === "string" && url.length > 0 ? url : null;
}

/**
 * What a buyer can pay with, in Stripe's spelling (T65, #137).
 *
 * **Never null, and never a reason to refuse the cards.** Unlike {@link asPlans}
 * above, the all-or-nothing argument does not reach here: the screen is a
 * comparison and this is a line under its title, so anything unreadable — absent,
 * not an array, an array with a number in it — costs the sentence and nothing
 * else. Non-strings are dropped rather than failing the lot, because one odd
 * entry says nothing about the rest.
 *
 * The tokens are not checked against a list of known methods. What this product
 * can *name* is `waysToPay`'s in `popup/plans.ts`, and a token nobody has named is
 * simply not rendered — deciding that here would put the vocabulary in two places.
 */
export function asPaymentMethods(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const methods = (body as Record<string, unknown>)["paymentMethods"];
  if (!Array.isArray(methods)) return [];
  return methods.filter((method): method is string => typeof method === "string" && method.length > 0);
}
