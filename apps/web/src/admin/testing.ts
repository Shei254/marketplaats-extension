/**
 * The browser bits the admin suites hand in, in one place.
 *
 * `AdminApp` and everything under it takes storage, `fetch` and navigation as
 * parameters — so these are what a test supplies instead, and they are here rather
 * than in each suite because three of them need the same `Storage` and the same
 * hand-signed token.
 */

/** A `Storage` that is a map, which is all any of this uses one for. */
export function inMemoryStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

/**
 * An access token carrying the given realm roles.
 *
 * **Unsigned, and that is the point rather than a shortcut**: nothing in this
 * bundle verifies a signature, because nothing in this bundle decides anything
 * with one. The API verifies, and a token forged here buys a screen full of
 * `403`s. A suite that had to sign would be a suite asserting a property that does
 * not exist.
 */
export function tokenFor(roles: string[], expiresAt = Date.now() + 300_000): string {
  const claims = { realm_access: { roles }, exp: Math.floor(expiresAt / 1000) };
  return `header.${base64Url(JSON.stringify(claims))}.signature`;
}

function base64Url(json: string): string {
  return btoa(json).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** A JSON `Response`, like the API and Keycloak both send. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Keycloak's discovery document, reduced to what this build reads out of it. */
export function discoveryDocument(issuer: string): Record<string, string> {
  return {
    issuer,
    authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
    token_endpoint: `${issuer}/protocol/openid-connect/token`,
    end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
  };
}
