import type { Http } from "../auth/discovery";
import {
  asServedConfig,
  forgetServedConfig,
  readServedConfig,
  writeServedConfig,
  type ServedConfig,
} from "../shared/served-config";
import { DEFAULT_API_CONFIG, type ApiConfig } from "./api-config";
import { clientHeaders } from "./client-release";
import type { AccessTokens } from "./display-state";

/**
 * `GET /api/client-config` — the worker's half of the served configuration
 * (T27, #36; ADR-0013).
 *
 * **The document is fetched here and applied nowhere near here.** This asks,
 * checks and stores; `loadEndpointConfig` is what lays the result over the
 * build's defaults, minutes or hours later, in whichever context is about to
 * call Marktplaats. The two are deliberately far apart: the reader is the content
 * script, on somebody else's page, and it shares nothing with this worker but
 * `chrome.storage.local`.
 *
 * **Nothing here is in the relist path**, which is ADR-0013's "adds no new
 * failure mode" spelled as code. A relist reads whatever is in storage and never
 * waits on this — so an API that cannot be reached costs the *freshness* of the
 * config and not the relist, which the gate is already fail-closed about for its
 * own reasons.
 */

/**
 * How long a stored document is taken on trust before it is asked about again.
 *
 * **Fifteen minutes, and the number is bounded on both sides by something real.**
 * The floor is what a worker wake costs: an MV3 worker is torn down about thirty
 * seconds after it goes idle, so it wakes on essentially every popup open, and a
 * refresh per wake would be a request per open for a document that changes on the
 * scale of a Marktplaats deploy. The ceiling is the whole point of ADR-0013 —
 * "minutes, not days" — measured from an operator deploying a fix to a user who
 * is sitting there retrying a relist that keeps failing.
 *
 * It is not configurable, and could not usefully be: the setting that would carry
 * it is in the document, so a client that had not fetched yet would not know it.
 */
const REFRESH_AFTER_MS = 15 * 60_000;

/**
 * What came of asking. Every one of these is a value rather than a throw, the way
 * every other call to our API here answers — and unlike those, nothing renders
 * any of it: the caller is a worker starting up and the reader is a console
 * (`__clientConfig`).
 *
 * `unavailable` and `unreadable` are the two that look alike and are opposite.
 * Nothing was reached, so **what was stored still stands** — an API blip must not
 * un-apply a hotfix that is holding relisting together. A `200` whose *JSON* this
 * build cannot read is an operator who has deployed something, and what was
 * stored is therefore superseded, so it goes. A `200` that is not JSON at all is
 * neither: it is a proxy or a captive portal, and it counts as unavailable.
 */
export type ClientConfigRefresh =
  | { status: "fresh"; config: ServedConfig }
  | { status: "stored"; config: ServedConfig }
  | { status: "unreadable" }
  | { status: "signed-out" }
  | { status: "outdated" }
  | { status: "unavailable" };

export interface ClientConfigDeps {
  tokens: AccessTokens;
  config?: ApiConfig;
  http?: Http;
  /** Injected so a test can say what time it is; `Date.now` in the worker. */
  clock?: () => number;
}

export class ClientConfigFetcher {
  private readonly config: ApiConfig;
  private readonly http: Http;
  private readonly clock: () => number;

  constructor(private readonly deps: ClientConfigDeps) {
    this.config = deps.config ?? DEFAULT_API_CONFIG;
    this.http = deps.http ?? ((url, init) => fetch(url, init));
    this.clock = deps.clock ?? (() => Date.now());
  }

  /**
   * Ask, unless what is already stored is younger than {@link REFRESH_AFTER_MS}.
   *
   * This is what the worker calls on every wake, which is why the throttle is
   * here rather than at the call site: a worker has no memory between wakes, so
   * "have I asked recently" is a question only storage can answer.
   *
   * A `fetchedAt` in the future is treated as stale rather than as fresh
   * forever — the clock is the user's machine's, it can jump, and the safe
   * reading of a timestamp that cannot be right is to go and ask.
   */
  async refreshIfStale(): Promise<ClientConfigRefresh> {
    const held = await readServedConfig();
    if (held !== null) {
      const age = this.clock() - held.fetchedAt;
      if (age >= 0 && age < REFRESH_AFTER_MS) return { status: "fresh", config: held.config };
    }
    return this.refresh();
  }

  /**
   * Ask regardless of what is stored.
   *
   * **Signed out is not a failure and not a reason to forget anything.** The
   * route is authenticated like every other one here, so a worker waking for a
   * user who has not signed in has nothing to ask with — and the document it
   * already holds is still the right one for the moment they do.
   */
  async refresh(): Promise<ClientConfigRefresh> {
    const token = await this.deps.tokens.accessToken();
    if (token.status !== "ready") return { status: token.status };

    let response: Response;
    try {
      response = await this.http(`${this.config.baseUrl}/api/client-config`, {
        headers: {
          authorization: `Bearer ${token.token}`,
          accept: "application/json",
          ...clientHeaders(),
        },
      });
    } catch {
      return { status: "unavailable" };
    }

    if (response.status === 401) return { status: "signed-out" };
    if (response.status === 426) return { status: "outdated" };
    if (!response.ok) return { status: "unavailable" };

    /**
     * **A `200` that is not JSON at all is not our API answering.** It is a
     * captive portal, a proxy, or a sign-in page some network put in the way —
     * and none of those are evidence that the document this client holds is
     * wrong. Reading them as "an operator deployed something I cannot parse"
     * would forget a live hotfix because somebody opened a laptop in a hotel.
     *
     * A body that *is* JSON and does not pass the checker is the other thing:
     * our API served it, and this release does not understand it.
     */
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "unavailable" };
    }

    const config = asServedConfig(body);
    if (config === null) {
      await forgetServedConfig();
      return { status: "unreadable" };
    }

    await writeServedConfig({ fetchedAt: this.clock(), config });
    return { status: "stored", config };
  }
}
