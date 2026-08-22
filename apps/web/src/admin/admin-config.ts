/**
 * Which Keycloak the admin corner signs into, as whom, and where our own API is
 * (T54, #85).
 *
 * **The `mprelist-dashboard` client has existed since #15** and this is the ticket
 * that finally uses it. It is a public client doing Authorization Code + PKCE from
 * the browser — the case PKCE was written for — and the realm requires `S256` of
 * it, which `KeycloakRealmTest` already pins from the other side.
 *
 * **The redirect URI is the origin root, and that is a constraint rather than a
 * preference.** The realm registers exactly `http://localhost:5173/` and Keycloak
 * matches redirect URIs exactly — `KeycloakRealmTest` proves a path beneath it is
 * refused with a page rather than a redirect. Since the realm imports on first
 * start only, wanting `/admin` back would mean a `down -v` on every stack that
 * already exists. It is also the shape that generalises: ADR-0017 serves `/admin`
 * from `admin.<domain>` at Go-Live, whose root is exactly this.
 *
 * These are the **local stack's** values, like the extension's own `auth-config.ts`
 * and for the same reason: nothing is deployed until T55 (#86). A build points at
 * localhost, which is what iteration 1 says it is.
 */
export interface AdminConfig {
  /** The OIDC issuer. Its discovery document is what every URL is read from. */
  issuer: string;
  clientId: string;
  /**
   * `openid` and nothing else. The realm attaches this client's own default scopes
   * whatever we ask for, and what decides whether a name or an address travels is
   * the client's `defaultClientScopes` in the realm rather than this string (#108).
   */
  scope: string;
  /** Where this page is sent back to, and what the realm has to have registered. */
  redirectUri: string;
  /** Our own API — the same origin the extension's `api-config.ts` names. */
  apiBaseUrl: string;
}

export const DEFAULT_ADMIN_CONFIG: AdminConfig = {
  issuer: "http://localhost:8081/realms/mprelist",
  clientId: "mprelist-dashboard",
  scope: "openid",
  redirectUri: "http://localhost:5173/",
  apiBaseUrl: "http://localhost:8080",
};

/**
 * The realm role that opens the admin API, spelled as the realm spells it and as
 * `OperatorsOnly` spells it on the other side.
 *
 * **Checked here for the screen and never for the security.** The API enforces it
 * server-side on every route under `/api/admin` (#27), so this is what decides
 * whether somebody is shown a catalog or told they are signed in as the wrong
 * person — a route guard, not a boundary. Deleting it would leak no data: every
 * call would come back `403`.
 */
export const ADMIN_ROLE = "ADMIN";
