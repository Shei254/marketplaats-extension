import { DEFAULT_AUTH_CONFIG, type AuthConfig } from "./auth-config";
import type { BrowserAuthFlow } from "./browser-flow";
import { fetchOidcEndpoints, type Http, type OidcEndpoints } from "./discovery";
import { SignInCancelledError, SignInFailedError } from "./errors";
import { challengeFor, createState, createVerifier } from "./pkce";
import {
  stateOf,
  type AccessToken,
  type AuthSession,
  type AuthState,
  type SessionStore,
} from "./session";

/**
 * Authorization Code + PKCE against Keycloak (ADR-0010), and the sign-out that
 * undoes it.
 *
 * **This runs in the service worker, never in the popup.** `launchWebAuthFlow`
 * opens a window, the popup loses focus and is torn down the moment it does, and a
 * flow awaiting a redirect in a page that no longer exists never resolves — the
 * same reason the orchestrator lives there (background/messages.ts).
 *
 * **Refresh happens at call time and never on a timer** (T24, #33). An MV3 worker
 * is evicted between one relist and the next, so a timer set now is a timer that
 * will not be there later — and a token refreshed on a schedule nobody is waiting
 * for is a request made for nothing. `accessToken()` is the whole of it: it hands
 * back a token that is good now, renewing it on the way if it is not.
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

  /**
   * The refresh in flight, shared by everyone who asks while it is running.
   *
   * Not an optimisation. The realm sets `revokeRefreshToken` with
   * `refreshTokenMaxReuse: 0` (infra/README.md), so a refresh token is spent by
   * the refresh that uses it: two of the worker's callers waking together and
   * each refreshing means the second presents a token Keycloak has already
   * retired, and the answer to that is not a slow call — it is the session ending.
   * This is the same one-in-flight shape `ensureCsrfToken` uses next door, for a
   * milder version of the same reason.
   */
  private refreshInFlight: Promise<AccessToken> | null = null;

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

  /**
   * A token good enough to send now, renewing the session on the way if it is not.
   *
   * Called at the moment a request needs one, which is the only moment an MV3
   * worker can be relied on to exist. Nothing here throws: the three answers are
   * the three states a caller has to render, and an exception would make "the
   * network hiccupped" indistinguishable from "you are signed out" at exactly the
   * point where the difference is the whole of what to show.
   */
  async accessToken(): Promise<AccessToken> {
    const session = await this.deps.store.read();
    if (!session) return SIGNED_OUT;
    if (this.stillGood(session)) return { status: "ready", token: session.accessToken };
    return this.refreshed(session);
  }

  /**
   * Whether the access token has enough life left to be worth sending.
   *
   * The margin is what stops a token that expires between this check and the
   * server reading it — a request in flight, a retry, a laptop that slept for a
   * moment. It costs nothing: renewing 30 seconds early throws away a
   * thirtieth of a five-minute token.
   *
   * The clock is the user's own and no attempt is made to be clever about that.
   * A device far ahead refreshes constantly, which is harmless; one far behind
   * sends a token the API refuses, and a `401` is already an answer the gate knows
   * what to do with (#34).
   */
  private stillGood(session: AuthSession): boolean {
    return session.expiresAt - this.now() > FRESH_ENOUGH_MS;
  }

  private refreshed(stale: AuthSession): Promise<AccessToken> {
    if (this.refreshInFlight) return this.refreshInFlight;

    const pending = this.renew(stale);
    this.refreshInFlight = pending;
    void pending.finally(() => {
      if (this.refreshInFlight === pending) this.refreshInFlight = null;
    });
    return pending;
  }

  /**
   * One refresh, and the decision of what its failure means.
   *
   * **Only `invalid_grant` ends the session.** That is the one OAuth error which
   * says the refresh token itself is spent, expired or revoked (RFC 6749 §5.2) —
   * everything else is our problem rather than the user's. A wrong `client_id`
   * answers `invalid_client`, and clearing every user's session over a
   * misconfigured deploy would turn a five-minute fix into a re-sign-in for
   * everybody who was logged in when it shipped.
   */
  private async renew(stale: AuthSession): Promise<AccessToken> {
    if (!stale.refreshToken) {
      // Past it, and nothing to renew with. Cleared rather than left to fail every
      // call from now on with a token that cannot come back.
      await this.deps.store.clear();
      return SIGNED_OUT;
    }

    let endpoints: OidcEndpoints;
    try {
      endpoints = await this.endpoints();
    } catch {
      return UNAVAILABLE;
    }

    const answer = await this.askTokenEndpoint(
      endpoints.tokenEndpoint,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: stale.refreshToken,
        client_id: this.config.clientId,
      }),
    );

    if (answer.kind === "unreachable") return UNAVAILABLE;

    if (answer.kind === "refused") {
      if (answer.status < 500 && answer.error === "invalid_grant") {
        await this.deps.store.clear();
        return SIGNED_OUT;
      }
      console.warn(`[auth] the session could not be renewed: ${answer.error ?? answer.status}`);
      return UNAVAILABLE;
    }

    try {
      const session = renewedSession(stale, answer.payload, this.now());
      await this.deps.store.write(session);
      return { status: "ready", token: session.accessToken };
    } catch {
      // A 200 carrying no usable token. Keycloak answering strangely is not the
      // session being over, so the session stays and the next call tries again.
      console.warn("[auth] the renewed session was not usable");
      return UNAVAILABLE;
    }
  }

  private async exchange(
    tokenEndpoint: string,
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<AuthSession> {
    const answer = await this.askTokenEndpoint(
      tokenEndpoint,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: this.config.clientId,
        code_verifier: verifier,
      }),
    );

    if (answer.kind === "unreachable") {
      throw new SignInFailedError("Could not reach the sign-in server to complete sign-in.");
    }
    if (answer.kind === "refused") {
      // Keycloak's own words — `invalid_grant`, `unauthorized_client` and the rest
      // say precisely what is misconfigured, and inventing a friendlier sentence
      // here would throw that away. No token can be in this body: it is an error.
      throw new SignInFailedError(
        `Keycloak refused the sign-in: ${answer.description ?? answer.error ?? answer.status}`,
      );
    }

    return sessionFrom(answer.payload, this.now());
  }

  /**
   * One POST to the token endpoint, in the one encoding it takes — shared by the
   * code exchange and the refresh, which differ only in the grant they name.
   *
   * It answers rather than throws, because the two callers do different things
   * with the same failures: a sign-in that cannot reach Keycloak is an error a
   * user just asked for and should be told about, and a refresh that cannot is a
   * session left alone until the next call.
   */
  private async askTokenEndpoint(tokenEndpoint: string, body: URLSearchParams): Promise<TokenAnswer> {
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
      return { kind: "unreachable" };
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      return {
        kind: "refused",
        status: response.status,
        error: stringIn(payload, "error"),
        description: stringIn(payload, "error_description"),
      };
    }
    return { kind: "granted", payload };
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

/** What the token endpoint said, in the three shapes its two callers act on. */
type TokenAnswer =
  | { kind: "granted"; payload: unknown }
  /**
   * Both spellings of the failure, because the two callers need different ones: a
   * refused sign-in repeats Keycloak's `description` to whoever just clicked, and
   * a refused refresh decides on the `error` code — `invalid_grant` is the one
   * that means the session is over (RFC 6749 §5.2), and matching on prose
   * Keycloak is free to reword would make that a translation away from wrong.
   */
  | { kind: "refused"; status: number; error: string | null; description: string | null }
  | { kind: "unreachable" };

const SIGNED_OUT: AccessToken = { status: "signed-out" };

const UNAVAILABLE: AccessToken = { status: "unavailable" };

/**
 * How much life an access token needs left to be worth sending, in milliseconds.
 * The realm mints them for five minutes (infra/README.md).
 */
const FRESH_ENOUGH_MS = 30_000;

/**
 * The session a refresh leaves behind: the new token, and the halves of the old
 * one Keycloak did not send back.
 *
 * The realm rotates refresh tokens and spends the old one on use, so a new one
 * replaces it. When the answer carries none, RFC 6749 §6 says the old one is
 * still good, and keeping it is what that means in practice. The **id token**
 * matters for a different reason: it is only ever used as the `id_token_hint`
 * that ends the Keycloak session at sign-out, and a refresh that quietly dropped
 * it would leave sign-out unable to do that — a bug that appears hours later, in
 * a different feature, as "signing in again never asks who I am".
 */
export function renewedSession(previous: AuthSession, payload: unknown, now: number): AuthSession {
  const renewed = sessionFrom(payload, now);
  return {
    ...renewed,
    refreshToken: renewed.refreshToken ?? previous.refreshToken,
    idToken: renewed.idToken ?? previous.idToken,
  };
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

/** One field of an OAuth error body, when it is there and is a string. */
function stringIn(payload: Record<string, unknown> | null, key: string): string | null {
  return optionalString(payload?.[key]);
}

/** An error's message and nothing else — never a session, never a token. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
