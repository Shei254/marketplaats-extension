import { isQuota, type RelistOutcomeCode, type RemainingQuota } from "@mprelist/contracts";

import type { Http } from "../auth/discovery";
import type { AccessTokens } from "./display-state";
import { decide, type AuthorizeAttempt, type GateDecision } from "../gate/authorization-gate";
import type { RelistPermission } from "../gate/relist-permission";
import { DEFAULT_API_CONFIG, type ApiConfig } from "./api-config";
import { clientHeaders } from "./client-release";

/**
 * The two ends of the gate, over HTTP (T26, #35): `POST /api/relist/authorize`
 * before anything is deleted, and `POST /api/relist/complete` to say what became
 * of it.
 *
 * The reading of the answer is not here — `decide` does that, and this hands it
 * the attempt whole. So there is one place that says what a `402` means and it is
 * a pure function with a suite of its own (#34); this file's job is the request,
 * the token on it, and turning a thrown `fetch` into an attempt that failed.
 */
export interface RelistApiDeps {
  tokens: AccessTokens;
  config?: ApiConfig;
  http?: Http;
}

export class RelistAuthorizations implements RelistPermission {
  private readonly config: ApiConfig;
  private readonly http: Http;

  constructor(private readonly deps: RelistApiDeps) {
    this.config = deps.config ?? DEFAULT_API_CONFIG;
    this.http = deps.http ?? ((url, init) => fetch(url, init));
  }

  async authorize(adId: string): Promise<GateDecision> {
    const token = await this.deps.tokens.accessToken();
    if (token.status !== "ready") {
      // No token is not a denial with a reason code, so it is not something the
      // gate can read — but it is certainly not permission. Handed over as an
      // attempt that never reached the backend, which is the same fail-closed
      // answer as a network failure: refused, and the popup's own next refresh is
      // what will tell the user they are signed out.
      return decide({ kind: "unreachable" });
    }

    return decide(await this.post("/api/relist/authorize", token.token, { adId }));
  }

  /**
   * Say what happened. **Best-effort, and deliberately quiet**: the relist has
   * already happened or already failed, and neither is undone by our failing to
   * report it. A reservation nobody reports on is refunded by the backend's
   * reconciliation after a grace window (#24), and a report that arrives later
   * still wins — which is what makes it safe for this to give up.
   */
  async report(jti: string, outcome: RelistOutcomeCode): Promise<RemainingQuota | null> {
    const token = await this.deps.tokens.accessToken();
    if (token.status !== "ready") {
      console.warn(`[relist] ${outcome} not reported: no access token`);
      return null;
    }

    const attempt = await this.post("/api/relist/complete", token.token, { jti, outcome });
    if (attempt.kind === "unreachable") {
      console.warn(`[relist] ${outcome} not reported: the backend could not be reached`);
      return null;
    }
    if (attempt.status !== 200) {
      console.warn(`[relist] ${outcome} not reported: the backend answered ${attempt.status}`);
      return null;
    }

    // The answer is the updated quota, so the popup needs no second `/api/me`
    // after a relist (T32, #41). Checked rather than trusted, like every other
    // body: a half-read one would put a number on the screen that the gate does
    // not agree with, which is the failure `RemainingQuota` exists to prevent.
    return asRemainingQuota(attempt.body);
  }

  private async post(path: string, token: string, body: unknown): Promise<AuthorizeAttempt> {
    let response: Response;
    try {
      response = await this.http(`${this.config.baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
          // Which build is asking (T43, #52). The gate needs no arm for the answer:
          // a `426` is not a `200`, and `decide` refuses everything that is not one
          // — which is the right thing for a build the backend has just stopped
          // serving. What says so to the user is the popup's own screen, since a
          // client this old is refused on every route including `/api/me`.
          ...clientHeaders(),
        },
        body: JSON.stringify(body),
      });
    } catch {
      return { kind: "unreachable" };
    }

    // The body is read whatever the status is: a denial carries its reason there,
    // and a `4xx` that is not a denial carries nothing at all — both of which the
    // gate reads as refusals, for different reasons and with different screens.
    return {
      kind: "answered",
      status: response.status,
      body: await response.json().catch(() => null),
    };
  }
}

/**
 * `{ quotaRemaining, resetAt }`, or nothing if that is not what came back.
 *
 * A `quotaRemaining` of `null` is a tier with no cap (T73, ADR-0029) and not a
 * body this could not read — the field is present and says there is no ceiling.
 */
export function asRemainingQuota(body: unknown): RemainingQuota | null {
  if (typeof body !== "object" || body === null) return null;
  const { quotaRemaining, resetAt } = body as Record<string, unknown>;
  if (!isQuota(quotaRemaining)) return null;
  if (typeof resetAt !== "string" || resetAt.length === 0) return null;
  return { quotaRemaining, resetAt };
}
