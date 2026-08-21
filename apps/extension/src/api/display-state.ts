import { SUBSCRIPTION_STATUSES, type DisplayState } from "@mprelist/contracts";

import type { AccessToken } from "../auth/session";
import type { Http } from "../auth/discovery";
import { DEFAULT_API_CONFIG, type ApiConfig } from "./api-config";

/**
 * `GET /api/me` — the snapshot both clients render after signing in
 * (`docs/enforcement-contract.md`). It grants nothing and spends nothing, so the
 * popup may ask for it as often as it is opened.
 *
 * **Fail-closed applies to display too.** There are three answers and one of them
 * is not "active": a backend that cannot be reached, or one whose answer cannot be
 * read, is `unavailable`. Rendering a stale or guessed plan would put a live
 * Repost button in front of a user the gate is about to refuse — which is the
 * failure ADR-0007 is written against, arriving through the display instead of
 * through the gate.
 */
export type DisplayStateAnswer =
  | { status: "ready"; plan: DisplayState }
  | { status: "signed-out" }
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
        headers: { authorization: `Bearer ${token.token}`, accept: "application/json" },
      });
    } catch {
      return UNAVAILABLE;
    }

    /**
     * `401` is the only refusal this route has — every user always has a
     * subscription, so a lapsed payer and an exhausted free user are both *shown*
     * their state rather than turned away. It means the token we just refreshed is
     * not one this API will take, and the only thing a user can do about that is
     * sign in again; calling it "unavailable" would offer them a retry button that
     * cannot work.
     */
    if (response.status === 401) return { status: "signed-out" };
    if (!response.ok) return UNAVAILABLE;

    const plan = asDisplayState(await response.json().catch(() => null));
    return plan ? { status: "ready", plan } : UNAVAILABLE;
  }
}

const UNAVAILABLE: DisplayStateAnswer = { status: "unavailable" };

/**
 * The body, checked rather than trusted — every field, because a half-read
 * snapshot renders as a plan with holes in it and the holes are the numbers.
 *
 * `features` is read as an object and not for its contents: no flag is defined
 * yet (`{}` on every tier in the catalog), and a client that started branching on
 * one before the contract names it would be guessing.
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
  if (typeof quotaRemaining !== "number" || !Number.isInteger(quotaRemaining) || quotaRemaining < 0) {
    return null;
  }
  // The grant, which is the other half of "2 of 3" (#41). Required like the rest:
  // a snapshot missing it would render a sentence with a hole where a number goes.
  if (
    typeof relistQuotaPerPeriod !== "number" ||
    !Number.isInteger(relistQuotaPerPeriod) ||
    relistQuotaPerPeriod < 0
  ) {
    return null;
  }
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
  };
}

function isSubscriptionStatus(value: unknown): value is DisplayState["subscriptionStatus"] {
  return (
    typeof value === "string" &&
    (SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
  );
}
