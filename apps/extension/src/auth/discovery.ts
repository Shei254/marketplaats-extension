import { SignInFailedError } from "./errors";

/**
 * The realm's OIDC discovery document, reduced to the three URLs this extension
 * uses.
 *
 * Read rather than composed. Keycloak's paths (`/protocol/openid-connect/auth`,
 * `…/token`, `…/logout`) are stable enough to hardcode, and hardcoding them is
 * still the wrong trade: the discovery document is the one thing every OIDC
 * provider agrees to publish, so reading it is what keeps ADR-0010's "revisit if a
 * second IdP has to be supported" a configuration change rather than a rewrite.
 * It also gives the issuer check below something to check against.
 */
export interface OidcEndpoints {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Optional in the spec; Keycloak publishes one, and sign-out needs it. */
  endSessionEndpoint: string | null;
}

/** Just enough of `fetch` to be faked in a test without a DOM. */
export type Http = (url: string, init?: RequestInit) => Promise<Response>;

export function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
}

export async function fetchOidcEndpoints(issuer: string, http: Http): Promise<OidcEndpoints> {
  const url = discoveryUrl(issuer);
  let response: Response;
  try {
    response = await http(url);
  } catch {
    // The realm being unreachable is the ordinary local failure — the stack is not
    // up. Say which URL, since that is the whole diagnosis.
    throw new SignInFailedError(`Could not reach the sign-in server at ${url}.`);
  }

  if (!response.ok) {
    throw new SignInFailedError(`The sign-in server answered ${response.status} for ${url}.`);
  }

  const document = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!document) throw new SignInFailedError(`${url} did not answer with JSON.`);

  const declaredIssuer = stringAt(document, "issuer");
  const authorizationEndpoint = stringAt(document, "authorization_endpoint");
  const tokenEndpoint = stringAt(document, "token_endpoint");

  if (!declaredIssuer || !authorizationEndpoint || !tokenEndpoint) {
    throw new SignInFailedError(`${url} is not an OIDC discovery document.`);
  }

  /**
   * The document has to say it belongs to the realm we asked for. Getting this
   * wrong is not exotic — one stale port or one wrong realm name in the config and
   * every token is minted by an issuer our API will refuse, which presents as a
   * 401 from our own backend long after the sign-in that caused it looked fine.
   */
  if (declaredIssuer !== issuer) {
    throw new SignInFailedError(
      `${url} belongs to ${declaredIssuer}, not to the realm this build is configured for.`,
    );
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
