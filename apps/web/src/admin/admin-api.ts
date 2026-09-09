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
 * The four routes the admin corner is made of (T54, #85): the catalog, an edit,
 * the move that says which tier new accounts start on, and the Stripe Prices
 * nobody tagged.
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
 * `unsellable` is the API's `409`, and since ADR-0029 it means one thing said two
 * ways — **this tier cannot go on sale as described**: either there is nothing to
 * charge for it (no Stripe Price, and the way out is Stripe's — create one tagged
 * with the tier's code) or nothing to get for the money (a quota of 0). Both forms
 * warn before they send, so what reaches this is a stale tab. `rejected` is a
 * `400`,
 * which for a form that always sends every field should be unreachable and is
 * rendered rather than swallowed, because unreachable is a claim and not a fact.
 */
export type EditAnswer = { status: "saved"; tier: AdminTier } | WriteRefusal;

/**
 * Every way a call can come back without a body. The last three only ever reach a
 * write — a `404` from the tier list would mean the API had moved, which is
 * nothing an operator can act on and so is folded into `unavailable`.
 */
type WriteRefusal =
  | Refusal
  | { status: "gone" }
  | { status: "unsellable" }
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
   * screen could send that leaves the catalog without a default (ADR-0019).
   */
  async makeDefault(code: string): Promise<EditAnswer> {
    return this.write(`/api/admin/tiers/${encodeURIComponent(code)}/default`, undefined);
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
    if (response.status === 409) return { status: "refused", refusal: { status: "unsellable" } };
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
  if (quota !== null && (typeof quota !== "number" || !Number.isInteger(quota) || quota < 0)) {
    return null;
  }

  const features = fields["features"];
  if (typeof features !== "object" || features === null || Array.isArray(features)) return null;

  const published = fields["published"];
  const isDefault = fields["isDefault"];
  if (typeof published !== "boolean" || typeof isDefault !== "boolean") return null;

  const prices = asTierPrices(fields["prices"]);
  if (!prices) return null;

  return {
    tier: { code, name },
    relistQuotaPerPeriod: quota as number | null,
    features: features as Record<string, unknown>,
    published,
    isDefault,
    prices,
  };
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
