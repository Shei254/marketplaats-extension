/**
 * The realm's OIDC discovery document, reduced to what a browser sign-in needs
 * (T54, #85).
 *
 * Read rather than composed, for the reason the extension's own `discovery.ts`
 * gives: Keycloak's paths are stable enough to hardcode and hardcoding them is
 * still the wrong trade, because the discovery document is the one thing every
 * OIDC provider agrees to publish. It is also what gives the issuer check below
 * something to check against.
 */
export interface OidcEndpoints {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Optional in the spec; Keycloak publishes one, and signing out needs it. */
  endSessionEndpoint: string | null;
}

/** Just enough of `fetch` to be handed a fake in a test. */
export type Http = (url: string, init?: RequestInit) => Promise<Response>;

export function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
}

/**
 * @throws Error with a sentence naming the URL — the whole diagnosis for the
 * ordinary local failure, which is the stack not being up
 */
export async function fetchOidcEndpoints(issuer: string, http: Http): Promise<OidcEndpoints> {
  const url = discoveryUrl(issuer);
  let response: Response;
  try {
    response = await http(url);
  } catch {
    throw new Error(`Could not reach the sign-in server at ${url}.`);
  }
  if (!response.ok) {
    throw new Error(`The sign-in server answered ${response.status} for ${url}.`);
  }

  const document = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!document) throw new Error(`${url} did not answer with JSON.`);

  const declaredIssuer = stringAt(document, "issuer");
  const authorizationEndpoint = stringAt(document, "authorization_endpoint");
  const tokenEndpoint = stringAt(document, "token_endpoint");
  if (!declaredIssuer || !authorizationEndpoint || !tokenEndpoint) {
    throw new Error(`${url} is not an OIDC discovery document.`);
  }

  /**
   * The document has to say it belongs to the realm we asked for. One stale port
   * or one wrong realm name and every token is minted by an issuer our own API
   * refuses — which presents as a `401` from the backend long after the sign-in
   * that caused it looked fine.
   */
  if (declaredIssuer !== issuer) {
    throw new Error(`${url} belongs to ${declaredIssuer}, not to the realm this build is configured for.`);
  }

  return {
    issuer: declaredIssuer,
    authorizationEndpoint,
    tokenEndpoint,
    endSessionEndpoint: stringAt(document, "end_session_endpoint"),
  };
}

function stringAt(document: Record<string, unknown>, key: string): string | null {
  const value = document[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
