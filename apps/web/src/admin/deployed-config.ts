import { DEFAULT_ADMIN_CONFIG, type AdminConfig } from "./admin-config";

/**
 * Where the deployment says the two other halves of the stack are (T55, #86).
 *
 * **A patch, not a configuration.** `admin-config.ts` holds what this build was
 * built with, and this says only where a deployment departs from it — the shape
 * `GET /api/client-config` already serves the extension ([ADR-0013](../../../../docs/adr/0013-remote-client-configuration.md)),
 * and for the same reason: a second copy of the local stack's addresses is a
 * second thing that can be wrong, and it goes stale on its own schedule.
 *
 * It arrives as `window.__MPRELIST_WEB_CONFIG__`, set by `/config.js` — a file
 * this repository commits as an empty object and the deployed image answers from
 * nginx with what its environment holds (`apps/web/nginx.conf.template`). So the
 * healthy answer on a development machine and the healthy answer in a container
 * with neither variable set are the same one, and both mean *the defaults are
 * correct*.
 *
 * **Two values, because the third is knowable.** The redirect URI is where this
 * page already is — the realm registers the origin root and matches it exactly
 * (ADR-0010, and `KeycloakRealmTest` proves a path beneath it is refused) — so
 * taking it from `location.origin` is not a convenience: it is the one value that
 * cannot then disagree with where the browser will actually come back to.
 * `clientId` is not patchable at all, because the realm the issuer names is ours
 * and the client in it is `mprelist-dashboard` everywhere.
 */
export function deployedConfig(
  patch: unknown,
  origin: string,
  defaults: AdminConfig = DEFAULT_ADMIN_CONFIG,
): AdminConfig {
  const served = (typeof patch === "object" && patch !== null ? patch : {}) as Record<string, unknown>;
  return {
    ...defaults,
    issuer: url(served.issuer) ?? defaults.issuer,
    apiBaseUrl: url(served.apiBaseUrl) ?? defaults.apiBaseUrl,
    redirectUri: `${origin.replace(/\/+$/, "")}/`,
  };
}

/**
 * One served address, or `null` for anything that is not one.
 *
 * **An empty string is not a value**, which is the whole of what the deployed
 * `/config.js` needs from this: nginx substitutes an unset variable as a blank
 * rather than leaving the key out, so a deployment that names only the issuer
 * serves `{"issuer":"…","apiBaseUrl":""}` and means "the built-in one" by the
 * second. That is the opposite of the rule `.env` keeps for the realm, where
 * defined-and-empty defeats a default — and it is opposite because the cost is:
 * there, a wrong value is imported once and undone by `down -v`; here it is
 * re-read at every page load.
 *
 * **A trailing slash is stripped**, and that one is not tidiness. `discovery.ts`
 * compares the issuer the document declares against the issuer we asked for
 * exactly, so `…/realms/mprelist/` signs nobody in and says so in a sentence
 * about the wrong realm.
 */
function url(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
}

declare global {
  interface Window {
    /** Set by `/config.js`, which every page loads before the bundle. */
    __MPRELIST_WEB_CONFIG__?: unknown;
  }
}
