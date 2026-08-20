import { DEFAULT_AUTH_CONFIG, type AuthConfig } from "./auth-config";
import type { BrowserAuthFlow } from "./browser-flow";
import { fetchOidcEndpoints, type Http, type OidcEndpoints } from "./discovery";
import { SignInCancelledError, SignInFailedError } from "./errors";
import { challengeFor, createState, createVerifier } from "./pkce";
import { stateOf, type AuthSession, type AuthState, type SessionStore } from "./session";

/**
 * Authorization Code + PKCE against Keycloak (ADR-0010), and the sign-out that
 * undoes it.
 *
 * **This runs in the service worker, never in the popup.** `launchWebAuthFlow`
 * opens a window, the popup loses focus and is torn down the moment it does, and a
 * flow awaiting a redirect in a page that no longer exists never resolves — the
 * same reason the orchestrator lives there (background/messages.ts).
 *
 * What this ticket (T23, #32) does **not** do is refresh. A session here is one
 * that was obtained; making a five-minute access token usable an hour later is
 * T24 (#33), which is also where the serialisation the realm's
 * `refreshTokenMaxReuse: 0` demands belongs (infra/README.md).
 */
export interface AuthenticatorDeps {
  flow: BrowserAuthFlow;
  store: SessionStore;
  config?: AuthConfig;
  http?: Http;
  now?: () => number;
}

export class Authenticator {
  private readonly config: AuthConfig;
  private readonly http: Http;
  private readonly now: () => number;
  /**
   * The discovery document, fetched once per worker lifetime — the *promise*, so
   * two callers waking together share one request rather than racing two. A
   * rejection is dropped rather than kept, or one unreachable realm would poison
   * every later attempt until the worker happened to be evicted.
   */
  private endpointsPromise: Promise<OidcEndpoints> | null = null;

  constructor(private readonly deps: AuthenticatorDeps) {
    this.config = deps.config ?? DEFAULT_AUTH_CONFIG;
    this.http = deps.http ?? ((url, init) => fetch(url, init));
    this.now = deps.now ?? (() => Date.now());
  }

  /** Whether a session is held. Says nothing about the access token being fresh. */
  async state(): Promise<AuthState> {
    return stateOf(await this.deps.store.read());
  }

  async signIn(): Promise<AuthState> {
    // Before the window, not after: a misconfigured issuer should fail here
    // rather than after a user has typed their password into a realm we then
    // refuse to accept a token from.
    const endpoints = await this.endpoints();

    const verifier = createVerifier();
    const expectedState = createState();
    const redirectUri = this.deps.flow.redirectUri();

    const authorizeUrl = new URL(endpoints.authorizationEndpoint);
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      scope: this.config.scope,
      state: expectedState,
      // The verifier itself stays here. This is the only thing the browser is
      // given, and it is a hash — which is the whole of PKCE.
      code_challenge: await challengeFor(verifier),
      code_challenge_method: "S256",
    }).toString();

    const launched = await this.deps.flow.launch(authorizeUrl.toString(), { interactive: true });
    if (!launched.ok) {
      throw launched.reason === "cancelled"
        ? new SignInCancelledError(launched.message)
        : new SignInFailedError(launched.message);
    }

    const code = authorizationCodeFrom(launched.redirectedTo, expectedState);
    const session = await this.exchange(endpoints.tokenEndpoint, code, verifier, redirectUri);
    await this.deps.store.write(session);
    return stateOf(session);
  }

  /**
   * Forget the session, then end the one Keycloak is holding.
   *
   * That order is the decision. Clearing first means a user is signed out of this
   * extension whatever the network does; ending the Keycloak session afterwards is
   * best-effort, and its failure is logged rather than raised. The alternative —
   * end the session, then clear — leaves somebody who clicked "sign out" on a
   * flaky connection still signed in, which is the one outcome sign-out must not
   * have.
   *
   * Ending it matters all the same: Keycloak's SSO cookie outlives our tokens, so
   * without this the next sign-in silently re-authenticates the same person with
   * no prompt, and "sign out and sign in as someone else" becomes impossible.
   */
  async signOut(): Promise<AuthState> {
    const session = await this.deps.store.read().catch(() => null);
    await this.deps.store.clear();

    if (session?.idToken) {
      try {
        await this.endKeycloakSession(session.idToken);
      } catch (error) {
        console.warn("[auth] the Keycloak session was not ended", describe(error));
      }
    }

    return { status: "signed-out" };
  }

  private async endKeycloakSession(idToken: string): Promise<void> {
    const endpoints = await this.endpoints();
    if (!endpoints.endSessionEndpoint) return;

    const logoutUrl = new URL(endpoints.endSessionEndpoint);
    logoutUrl.search = new URLSearchParams({
      id_token_hint: idToken,
      post_logout_redirect_uri: this.deps.flow.redirectUri(),
      client_id: this.config.clientId,
    }).toString();

    // Non-interactive: with a valid hint Keycloak ends the session and redirects
    // without showing anything, so a window that *would* need a click means
    // something is wrong and there is nobody to click it — this is not a moment
    // the user asked to look at a browser window.
    const outcome = await this.deps.flow.launch(logoutUrl.toString(), { interactive: false });
    if (!outcome.ok) throw new SignInFailedError(outcome.message);
  }

  private async exchange(
    tokenEndpoint: string,
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<AuthSession> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: this.config.clientId,
      code_verifier: verifier,
    });

    let response: Response;
    try {
      response = await this.http(tokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: body.toString(),
      });
    } catch {
      throw new SignInFailedError("Could not reach the sign-in server to complete sign-in.");
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (!response.ok) {
      // Keycloak's own words — `invalid_grant`, `unauthorized_client` and the rest
      // say precisely what is misconfigured, and inventing a friendlier sentence
      // here would throw that away. No token can be in this body: it is an error.
      throw new SignInFailedError(
        `Keycloak refused the sign-in: ${describeOauthError(payload) ?? response.status}`,
      );
    }

    return sessionFrom(payload, this.now());
  }

  private endpoints(): Promise<OidcEndpoints> {
    if (!this.endpointsPromise) {
      const pending = fetchOidcEndpoints(this.config.issuer, this.http);
      this.endpointsPromise = pending;
      pending.catch(() => {
        if (this.endpointsPromise === pending) this.endpointsPromise = null;
      });
    }
    return this.endpointsPromise;
  }
}

/**
 * The code out of the URL Chrome handed back, or a failure.
 *
 * `state` is checked **first**, before the response is read for anything else. A
 * redirect that does not carry the value this request generated is not this
 * request's answer, and the right thing to do with it is nothing at all — not read
 * an error message out of it, and certainly not spend the code it carries.
 */
export function authorizationCodeFrom(redirectedTo: string, expectedState: string): string {
  let params: URLSearchParams;
  try {
    params = new URL(redirectedTo).searchParams;
  } catch {
    throw new SignInFailedError("The sign-in window came back with something that is not a URL.");
  }

  if (params.get("state") !== expectedState) {
    throw new SignInFailedError("The sign-in response does not belong to this sign-in.");
  }

  const error = params.get("error");
  if (error) {
    const description = params.get("error_description");
    throw new SignInFailedError(`Keycloak refused the sign-in: ${description ?? error}`);
  }

  const code = params.get("code");
  if (!code) throw new SignInFailedError("The sign-in window came back without an authorization code.");
  return code;
}

/**
 * A token response, checked rather than trusted.
 *
 * A 200 that carried no access token would otherwise be stored as a session, and
 * every later call would present `undefined` as a bearer — a signed-in state that
 * cannot do anything, which is worse than a sign-in that failed.
 */
export function sessionFrom(payload: unknown, now: number): AuthSession {
  const body = (payload ?? {}) as Record<string, unknown>;
  const accessToken = body["access_token"];
  const expiresIn = body["expires_in"];

  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new SignInFailedError("Keycloak's answer carried no access token.");
  }
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn)) {
    throw new SignInFailedError("Keycloak's answer did not say when the access token expires.");
  }

  return {
    accessToken,
    refreshToken: optionalString(body["refresh_token"]),
    idToken: optionalString(body["id_token"]),
    expiresAt: now + expiresIn * 1000,
    obtainedAt: now,
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function describeOauthError(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const error = payload["error"];
  const description = payload["error_description"];
  if (typeof description === "string" && description.length > 0) return description;
  return typeof error === "string" && error.length > 0 ? error : null;
}

/** An error's message and nothing else — never a session, never a token. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
