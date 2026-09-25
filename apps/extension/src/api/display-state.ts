import {
  SUBSCRIPTION_STATUSES,
  isQuota,
  type DenialReason,
  type DisplayState,
} from "@mprelist/contracts";

import type { AccessToken } from "../auth/session";
import type { Http } from "../auth/discovery";
import { DEFAULT_API_CONFIG, type ApiConfig } from "./api-config";
import { clientHeaders } from "./client-release";

/**
 * `GET /api/me` — the snapshot both clients render after signing in
 * (`docs/enforcement-contract.md`). It grants nothing and spends nothing, so the
 * popup may ask for it as often as it is opened.
 *
 * **Fail-closed applies to display too.** Only one of the five answers is a plan:
 * a backend that cannot be reached, or one whose answer cannot be read, is
 * `unavailable`. Rendering a stale or guessed plan would put a live Repost button
 * in front of a user the gate is about to refuse — which is the failure ADR-0007
 * is written against, arriving through the display instead of through the gate.
 */
export type DisplayStateAnswer =
  | { status: "ready"; plan: DisplayState }
  | { status: "signed-out" }
  /**
   * This build is older than the oldest the backend still serves (T43, #52). It is
   * a screen of its own because it is the one refusal a *retry* cannot fix and the
   * user can: everything else this API answers is refused the same way, so there is
   * no plan to show and no ad list worth listing — only one instruction.
   */
  | { status: "outdated" }
  /**
   * The backend has this account on no plan at all (T77, ADR-0032). An operator
   * deleted the tier they were on and the catalog had no default to move them
   * to, so there is no name, no grant and no reset date to render.
   *
   * **A screen of its own for `outdated`'s reason, and the opposite of
   * `unavailable`.** Nothing is broken and nothing is down: the backend answered
   * promptly and truthfully, and no retry changes the answer — an operator has to
   * make a tier the default, and everybody naming none is adopted onto it at
   * once. Calling it unavailable would offer a retry button that cannot work, on
   * the one failure a user genuinely cannot act on.
   */
  | { status: "no-tier" }
  | { status: "unavailable" };

export interface AccessTokens {
  accessToken(): Promise<AccessToken>;
}

export interface ApiDeps {
  tokens: AccessTokens;
  config?: ApiConfig;
  http?: Http;
}

export class MprelistApi {
  private readonly config: ApiConfig;
  private readonly http: Http;

  constructor(private readonly deps: ApiDeps) {
    this.config = deps.config ?? DEFAULT_API_CONFIG;
    this.http = deps.http ?? ((url, init) => fetch(url, init));
  }

  async displayState(): Promise<DisplayStateAnswer> {
    const token = await this.deps.tokens.accessToken();
    if (token.status !== "ready") return { status: token.status };

    let response: Response;
    try {
      response = await this.http(`${this.config.baseUrl}/api/me`, {
        headers: {
          authorization: `Bearer ${token.token}`,
          accept: "application/json",
          ...clientHeaders(),
        },
      });
    } catch {
      return UNAVAILABLE;
    }

    /**
     * Not signed in. Nearly nothing else on this route is refusable — every user
     * always has a subscription *row*, so a lapsed payer and an exhausted free user
     * are both *shown* their state rather than turned away — and this means the
     * token we just refreshed is not one the API will take. The only thing a user
     * can do about that is sign in again; calling it "unavailable" would offer them
     * a retry button that cannot work.
     */
    if (response.status === 401) return { status: "signed-out" };
    /**
     * The one denial this route has, and it is read by its **code** rather than by
     * its status — which is the contract's own rule and the difference between
     * this line and the two around it. `401` and `426` carry no body to read, so
     * the status is the whole of what they say; a denial carries `reason`, and
     * some other `403` on this path (none exists today) would be a statement about
     * something else. Read before `!response.ok`, or it would be one more
     * "unavailable" and the user would be offered a retry that cannot work.
     */
    if (response.status === 403) {
      const denial = await response.json().catch(() => null);
      if (isDenial(denial, "NO_TIER")) return { status: "no-tier" };
      return UNAVAILABLE;
    }
    /**
     * `426 Upgrade Required` is the one answer this client reads by *status* rather
     * than by a reason code, and the contract says why: the codes are statements
     * about the user — their quota, their card, their pace — and this is a statement
     * about their software, which carries no reason for the same rule every other
     * non-denial `4xx` follows. Read before `!response.ok`, or it would be one more
     * "unavailable" and the one thing the user could have done about it would never
     * be said (T43, #52).
     */
    if (response.status === 426) return { status: "outdated" };
    if (!response.ok) return UNAVAILABLE;

    const plan = asDisplayState(await response.json().catch(() => null));
    return plan ? { status: "ready", plan } : UNAVAILABLE;
  }
}

const UNAVAILABLE: DisplayStateAnswer = { status: "unavailable" };

/**
 * Whether a body is the denial shape carrying this exact code.
 *
 * Checked rather than assumed, for `asDisplayState`'s reason one function down: a
 * `403` whose body is not a denial at all is a backend saying something this build
 * has never heard of, and the honest answer to that is `unavailable` — not a
 * screen telling somebody their plan was deleted.
 */
function isDenial(body: unknown, reason: DenialReason): boolean {
  if (typeof body !== "object" || body === null) return false;
  return (body as Record<string, unknown>)["reason"] === reason;
}

/**
 * The body, checked rather than trusted — every field, because a half-read
 * snapshot renders as a plan with holes in it and the holes are the numbers.
 *
 * `features` is read as an object and not for its contents: no flag is defined
 * yet (`{}` on every tier in the catalog), and a client that started branching on
 * one before the contract names it would be guessing.
 *
 * **A quota of `null` is a value and not a hole** (T73, ADR-0029) — a tier with no
 * cap. The two nullable fields are checked the same way and are always null
 * together: one is the ceiling and the other is what is left under it. A parser
 * that refused them would render "unavailable" to the users on the most generous
 * plan in the catalog.
 */
export function asDisplayState(body: unknown): DisplayState | null {
  if (typeof body !== "object" || body === null) return null;
  const fields = body as Record<string, unknown>;

  const status = fields["subscriptionStatus"];
  const tier = fields["tier"];
  const quotaRemaining = fields["quotaRemaining"];
  const relistQuotaPerPeriod = fields["relistQuotaPerPeriod"];
  const resetAt = fields["resetAt"];
  const features = fields["features"];

  if (!isSubscriptionStatus(status)) return null;
  if (!isQuota(quotaRemaining)) return null;
  // The grant, which is the other half of "2 of 3" (#41). Required like the rest:
  // a snapshot missing it would render a sentence with a hole where a number goes.
  if (!isQuota(relistQuotaPerPeriod)) return null;
  if (typeof resetAt !== "string" || resetAt.length === 0) return null;
  if (typeof features !== "object" || features === null || Array.isArray(features)) return null;

  if (typeof tier !== "object" || tier === null) return null;
  const { code, name } = tier as Record<string, unknown>;
  if (typeof code !== "string" || code.length === 0) return null;
  if (typeof name !== "string" || name.length === 0) return null;

  return {
    subscriptionStatus: status,
    tier: { code, name },
    quotaRemaining,
    relistQuotaPerPeriod,
    resetAt,
    features: features as Record<string, unknown>,
    // T85's two, read leniently: the popup draws neither, and an API from
    // before them is somebody this client has no reason to turn away.
    paying: fields["paying"] === true,
    rhythm: typeof fields["rhythm"] === "string" ? fields["rhythm"] : null,
  };
}

function isSubscriptionStatus(value: unknown): value is DisplayState["subscriptionStatus"] {
  return (
    typeof value === "string" &&
    (SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
  );
}
