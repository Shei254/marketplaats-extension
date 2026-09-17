import { isQuota } from "@mprelist/contracts";
import type {
  AdminTier,
  NewPlan,
  NewPrice,
  CatalogCurrency,
  TierEdit,
  TierPriceOnTheWire,
  UntaggedPrice,
} from "@mprelist/contracts";

import type { AdminConfig } from "./admin-config";
import type { Http } from "./discovery";

/**
 * The routes the admin corner is made of (T54, #85): the catalog, an edit, a delete
 * (T77), the move that says which tier new accounts start on, the sequence they are
 * all read in (T75, #164), and the Stripe Prices nobody tagged.
 *
 * **Every answer is a value and nothing throws**, which is the arrangement the
 * extension's own clients keep: this surface has a screen for each outcome and no
 * screen for an exception.
 *
 * **`403` is its own answer and is not `unavailable`.** It means the operator is
 * signed in as somebody without the `ADMIN` role, which is not a fault, not a
 * retry, and not a reason to send them round the sign-in loop — they would come
 * back as the same person. `401` is the opposite: the token this tab holds has
 * expired (there is no refresh, by design), and one redirect fixes it.
 */
type Refusal =
  | { status: "signed-out" }
  | { status: "forbidden" }
  | { status: "unavailable" };

export type CatalogAnswer = { status: "ready"; tiers: AdminTier[] } | Refusal;

export type PricesAnswer = { status: "ready"; prices: UntaggedPrice[] } | Refusal;

/**
 * What came of writing.
 *
 * `conflicted` is the API's `409`, and since ADR-0031 it means one thing said four
 * ways — **the catalog cannot hold this tier as described**: nothing to charge for
 * it (no Stripe Price, and the way out is Stripe's — create one tagged with the
 * tier's code), nothing to get for the money (a quota of 0), a code moved on a tier
 * a Price has frozen, or a code another tier already holds. It was `unsellable` and
 * covered the first two; the name moved with the meaning rather than staying a
 * label that was right about half of what it now carries.
 *
 * **The form checks every one of them first**, because it is holding the whole
 * catalog and the API deliberately sends no `reason` — so what reaches this is a
 * stale tab. `rejected` is a `400`, which for a form that always sends every field
 * should be unreachable and is rendered rather than swallowed, because unreachable
 * is a claim and not a fact.
 */
export type EditAnswer = { status: "saved"; tier: AdminTier } | WriteRefusal;

/**
 * What came of deleting a tier (T77, ADR-0032).
 *
 * `deleted` carries the whole catalog as the API now holds it, for `ordered`'s
 * reason and one more of its own: a delete can move the default badge, and can
 * leave the list **empty** — which is a state and not a failure, and is what the
 * screen has to be able to draw.
 *
 * `gone` is the API's `404` and its only refusal: **every tier is deletable**, the
 * default one and the last one included, so there is no state of the catalog this
 * route declines to produce. A `404` therefore means one thing — the row was
 * already gone when this tab asked — and the answer is a reload rather than a
 * sentence about what a tier may be.
 */
export type DeleteAnswer =
  | { status: "deleted"; tiers: AdminTier[] }
  | { status: "gone" }
  | Refusal;

/**
 * What came of setting the Catalog order (T75, #164).
 *
 * `ordered` carries the whole catalog as the API now holds it, so the table
 * reconciles against what was stored rather than keeping the row where it was
 * dropped. `stale` is the API's `409` and is the only refusal with an instruction
 * in it: the list this screen sent was not the catalog's set, which means a tier
 * arrived or left while the page was open — reload and try again. It is a
 * *different sentence* from the edit form's `conflicted`, which is the same status
 * meaning something else entirely, and that is why this answer does not reuse it.
 */
export type OrderAnswer =
  | { status: "ordered"; tiers: AdminTier[] }
  | { status: "stale" }
  | Refusal;

/**
 * Every way a call can come back without a body. The last three only ever reach a
 * write — a `404` from the tier list would mean the API had moved, which is
 * nothing an operator can act on and so is folded into `unavailable`.
 */
type WriteRefusal =
  | Refusal
  | { status: "gone" }
  | { status: "conflicted" }
  | { status: "rejected" };

/**
 * What came of creating a plan.
 *
 * `exists` is the `409` and means the code is taken — the check that makes "create"
 * mean create rather than silently repointing an existing tier's Price. `refused`
 * is the `422`, and it is the one answer in this whole API that carries a sentence:
 * Stripe's own words about what is wrong with the amount or the currency, which no
 * status could convey and which the operator is the one who can act on.
 */
export type CreateAnswer =
  | { status: "created"; tier: AdminTier }
  | { status: "exists" }
  | { status: "refused"; problem: string }
  | { status: "rejected" }
  | Refusal;

export type CurrencyAnswer = { status: "ready"; currency: string } | Refusal;

export class AdminApi {
  constructor(
    private readonly config: AdminConfig,
    private readonly token: () => string,
    private readonly http: Http = (url, init) => fetch(url, init),
  ) {}

  async tiers(): Promise<CatalogAnswer> {
    const answer = await this.call("/api/admin/tiers");
    if (answer.status !== "ok") return readRefusal(answer.refusal);
    const tiers = asAdminTiers(answer.body);
    return tiers ? { status: "ready", tiers } : UNAVAILABLE;
  }

  async unadoptedPrices(): Promise<PricesAnswer> {
    const answer = await this.call("/api/admin/prices");
    if (answer.status !== "ok") return readRefusal(answer.refusal);
    const prices = asUntaggedPrices(answer.body);
    return prices ? { status: "ready", prices } : UNAVAILABLE;
  }

  async save(code: string, edit: TierEdit): Promise<EditAnswer> {
    return this.write(`/api/admin/tiers/${encodeURIComponent(code)}`, JSON.stringify(edit));
  }

  /**
   * Make this tier the one new accounts are provisioned onto. **A move, never a
   * toggle** — the API offers no way to unset it, so there is no request this
   * screen could send that *clears* the flag (ADR-0019). Deleting the tier holding
   * it can still leave the catalog without a default (T77, ADR-0032), which is a
   * deliberate act with a quantified confirmation in front of it.
   *
   * **It is also what heals an emptied catalog**: every subscription naming no tier
   * is adopted onto the new default in the same transaction, so everybody is on a
   * plan again the moment this answers — including the accounts that never sign in.
   */
  async makeDefault(code: string): Promise<EditAnswer> {
    return this.write(`/api/admin/tiers/${encodeURIComponent(code)}/default`, undefined);
  }

  /**
   * Set the order the plan cards are read in: **every tier, in one request** (T75,
   * #164; ADR-0030).
   *
   * **A sequence, never a per-row index.** Moving one tier moves others, so the
   * order is a property of the catalog rather than of a row — the same reason
   * `isDefault` has a route of its own. Sent whole, one drag is one write and there
   * is no half-applied order for a failed third call to leave behind.
   *
   * The `409` becomes `stale` rather than the `conflicted` the shared reader would
   * make of it: on this route it means the list was not the catalog's set, which is
   * a reload rather than a sentence about what a tier may be sold for.
   */
  async order(codes: string[]): Promise<OrderAnswer> {
    const answer = await this.call("/api/admin/tiers/order", {
      method: "PUT",
      body: JSON.stringify({ codes }),
      headers: { "content-type": "application/json" },
    });
    if (answer.status !== "ok") {
      return answer.refusal.status === "conflicted" ? { status: "stale" } : readRefusal(answer.refusal);
    }
    const tiers = asAdminTiers(answer.body);
    return tiers ? { status: "ordered", tiers } : UNAVAILABLE;
  }

  /**
   * Delete a tier — **any tier**, the default one and the last one included (T77,
   * [ADR-0032]).
   *
   * **Its own request rather than through `write`**, for `order`'s reason: the
   * answer is the whole catalog rather than one row, and its `404` means something
   * this screen acts on differently from an edit's. Nothing else about it is
   * special — no body, and one refusal.
   *
   * What happens to the people on the tier and to Stripe is the API's, and is not
   * instant: subscribers move to the default tier (or to no tier, if this *was* the
   * default) inside the same transaction, and the Stripe work — cancelling live
   * subscriptions, archiving and untagging every Price, archiving the Product — is
   * queued and drained by a scheduled job. So the catalog is right the moment this
   * answers, and the two systems agree shortly afterwards.
   */
  async remove(code: string): Promise<DeleteAnswer> {
    const answer = await this.call(`/api/admin/tiers/${encodeURIComponent(code)}`, {
      method: "DELETE",
    });
    if (answer.status !== "ok") {
      return answer.refusal.status === "gone" ? { status: "gone" } : readRefusal(answer.refusal);
    }
    const tiers = asAdminTiers(answer.body);
    return tiers ? { status: "deleted", tiers } : UNAVAILABLE;
  }

  /**
   * The one currency this catalog prices in — asked of Stripe, never listed here.
   *
   * **Every tier, the same currency** (T63, #129): a plan screen is a comparison,
   * and €9,99 against $12.99 is not one a buyer can make. So a form *shows* this
   * rather than offering it, and no request carries a currency at all.
   *
   * A form that cannot find out says so rather than guessing, because the guess is
   * a Price the Stripe account cannot settle in.
   */
  async currency(): Promise<CurrencyAnswer> {
    const answer = await this.call("/api/admin/currency");
    if (answer.status !== "ok") return readRefusal(answer.refusal);
    const currency = asCurrency(answer.body);
    return currency ? { status: "ready", currency } : UNAVAILABLE;
  }

  /**
   * Create a plan: a Stripe Product and Price, then the tier the sync makes from it.
   *
   * **Its own request rather than through `call`**, because its statuses genuinely
   * differ: `409` means the code is taken rather than "nothing to charge against",
   * and `422` is the only answer anywhere in this API with a body worth reading.
   */
  async createPlan(plan: NewPlan): Promise<CreateAnswer> {
    return this.created("/api/admin/plans", plan);
  }

  /** The shape both creations share: a POST, a `422` that carries a sentence, and a tier back. */
  private async created(path: string, body: unknown): Promise<CreateAnswer> {
    let response: Response;
    try {
      response = await this.http(`${this.config.apiBaseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token()}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      return UNAVAILABLE;
    }

    if (response.status === 401) return { status: "signed-out" };
    if (response.status === 403) return { status: "forbidden" };
    if (response.status === 409) return { status: "exists" };
    if (response.status === 400) return { status: "rejected" };
    if (response.status === 422) {
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const problem = body?.["problem"];
      return {
        status: "refused",
        problem: typeof problem === "string" && problem.length > 0 ? problem : "Stripe refused the plan.",
      };
    }
    if (!response.ok) return UNAVAILABLE;

    const tier = asAdminTier(await response.json().catch(() => null));
    return tier ? { status: "created", tier } : UNAVAILABLE;
  }

  /**
   * Add a rhythm to a plan that exists, or reprice one it already has (T62, #128).
   *
   * **One call for both, because in Stripe they are one act** — create a Price
   * tagged with the tier's code. What decides which happened is whether the tier
   * already sells at that rhythm: adding lands beside the existing one, repricing
   * replaces it, and everybody already subscribed keeps the Price they bought.
   */
  async addPrice(code: string, price: NewPrice): Promise<CreateAnswer> {
    return this.created(`/api/admin/tiers/${encodeURIComponent(code)}/prices`, price);
  }

  private async write(path: string, body: string | undefined): Promise<EditAnswer> {
    const answer = await this.call(path, {
      method: "PUT",
      ...(body === undefined ? {} : { body, headers: { "content-type": "application/json" } }),
    });
    if (answer.status !== "ok") return answer.refusal;
    const tier = asAdminTier(answer.body);
    return tier ? { status: "saved", tier } : UNAVAILABLE;
  }

  /**
   * One request, one token, and the statuses turned into answers.
   *
   * The `404`/`409`/`400` trio only reaches the write path, which is the only
   * caller that can distinguish them — a `404` from the list would mean the API
   * moved, which is `unavailable` and nothing an operator can act on.
   */
  private async call(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: "ok"; body: unknown } | { status: "refused"; refusal: WriteRefusal }> {
    let response: Response;
    try {
      response = await this.http(`${this.config.apiBaseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.token()}`,
          accept: "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch {
      return { status: "refused", refusal: UNAVAILABLE };
    }

    if (response.status === 401) return { status: "refused", refusal: { status: "signed-out" } };
    if (response.status === 403) return { status: "refused", refusal: { status: "forbidden" } };
    if (response.status === 404) return { status: "refused", refusal: { status: "gone" } };
    if (response.status === 409) return { status: "refused", refusal: { status: "conflicted" } };
    if (response.status === 400) return { status: "refused", refusal: { status: "rejected" } };
    if (!response.ok) return { status: "refused", refusal: UNAVAILABLE };
    return { status: "ok", body: await response.json().catch(() => null) };
  }
}

const UNAVAILABLE = { status: "unavailable" } as const;

/**
 * A refusal as a read can render it. Only two of the six mean anything to somebody
 * looking at a list — sign in again, or you are the wrong person — and the rest
 * are the API not answering, whatever status it said that in.
 */
function readRefusal(refusal: WriteRefusal): Refusal {
  return refusal.status === "signed-out" || refusal.status === "forbidden" ? refusal : UNAVAILABLE;
}

/**
 * The catalog, checked rather than trusted — every field of every row, and the
 * whole list refused if one of them is wrong.
 *
 * All of them or none of them, for the reason `GET /api/plans`'s own reader keeps:
 * a half-read catalog is worse than none, because the rows that survived look
 * complete and this is the screen somebody edits a quota on.
 */
export function asAdminTiers(body: unknown): AdminTier[] | null {
  if (typeof body !== "object" || body === null) return null;
  const tiers = (body as Record<string, unknown>)["tiers"];
  if (!Array.isArray(tiers)) return null;

  const read: AdminTier[] = [];
  for (const entry of tiers) {
    const tier = asAdminTier(entry);
    if (!tier) return null;
    read.push(tier);
  }
  return read;
}

export function asAdminTier(entry: unknown): AdminTier | null {
  if (typeof entry !== "object" || entry === null) return null;
  const fields = entry as Record<string, unknown>;

  const tier = fields["tier"];
  if (typeof tier !== "object" || tier === null) return null;
  const { code, name } = tier as Record<string, unknown>;
  if (typeof code !== "string" || code.length === 0) return null;
  if (typeof name !== "string") return null;

  // `null` is a tier with no cap (T73, ADR-0029) and is a value rather than a hole:
  // a parser that refused it would blank this screen over the one row an operator
  // most needs to see.
  const quota = fields["relistQuotaPerPeriod"];
  if (!isQuota(quota)) return null;

  const features = fields["features"];
  if (typeof features !== "object" || features === null || Array.isArray(features)) return null;

  const published = fields["published"];
  const isDefault = fields["isDefault"];
  if (typeof published !== "boolean" || typeof isDefault !== "boolean") return null;

  const prices = asTierPrices(fields["prices"]);
  if (!prices) return null;

  // The two counts a delete confirmation is quantified from (T77, ADR-0032).
  // Required like every other field, and for this screen's standing reason: the row
  // that survived a half-read looks complete, and here the missing number is the one
  // that decides whether an irreversible button asks for anything.
  const subscribers = asCount(fields["subscribers"]);
  const payingSubscribers = asCount(fields["payingSubscribers"]);
  if (subscribers === null || payingSubscribers === null) return null;

  return {
    tier: { code, name },
    relistQuotaPerPeriod: quota,
    features: features as Record<string, unknown>,
    published,
    isDefault,
    prices,
    subscribers,
    payingSubscribers,
  };
}

/** A count of people: a whole number, never negative. */
function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Every Stripe Price a tier is sold at (T62, #128). **Empty is legal here**, unlike
 * on a plan card: the free tier is sold at none, and so is any tier whose Price has
 * not been created yet — which is exactly the row this screen exists to act on.
 */
function asTierPrices(value: unknown): TierPriceOnTheWire[] | null {
  if (!Array.isArray(value)) return null;
  const read: TierPriceOnTheWire[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const fields = entry as Record<string, unknown>;
    const stripePriceId = fields["stripePriceId"];
    const interval = fields["interval"];
    if (typeof stripePriceId !== "string" || stripePriceId.length === 0) return null;
    if (typeof interval !== "string" || interval.length === 0) return null;
    read.push({ stripePriceId, interval });
  }
  return read;
}

export function asCurrency(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const currency = (body as Partial<CatalogCurrency>).currency;
  return typeof currency === "string" && currency.length > 0 ? currency : null;
}

export function asUntaggedPrices(body: unknown): UntaggedPrice[] | null {
  if (typeof body !== "object" || body === null) return null;
  const prices = (body as Record<string, unknown>)["prices"];
  if (!Array.isArray(prices)) return null;

  const read: UntaggedPrice[] = [];
  for (const entry of prices) {
    if (typeof entry !== "object" || entry === null) return null;
    const fields = entry as Record<string, unknown>;
    const id = fields["id"];
    const currency = fields["currency"];
    const amount = fields["amount"];
    const nickname = fields["nickname"];
    const interval = fields["interval"];
    if (typeof id !== "string" || id.length === 0) return null;
    if (typeof currency !== "string" || currency.length === 0) return null;
    if (typeof amount !== "number" || !Number.isInteger(amount)) return null;
    if (nickname !== null && typeof nickname !== "string") return null;
    if (interval !== null && typeof interval !== "string") return null;
    read.push({ id, nickname, amount, currency, interval });
  }
  return read;
}
