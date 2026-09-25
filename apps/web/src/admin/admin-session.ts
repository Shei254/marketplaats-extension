import { ADMIN_ROLE, type AdminConfig } from "./admin-config";
import { fetchOidcEndpoints, type Http } from "./discovery";
import { challengeFor, createState, createVerifier } from "./pkce";

/**
 * Signing an operator in, and what comes back (T54, #85).
 *
 * **Authorization Code + PKCE against the `mprelist-dashboard` client**, which the
 * realm has defined since #15 and which nothing has used until now. ADR-0017 makes
 * this the *only* authenticated part of `apps/web`: there is no customer login,
 * and there never was one to reuse.
 *
 * <h2>The token lives in memory and nowhere else</h2>
 *
 * Not in `localStorage`, not in a cookie, not in `sessionStorage`. A reload signs
 * in again — which, while Keycloak's own SSO session is alive, is a redirect the
 * operator does not see. Two things are bought by that and both matter more than
 * the round trip: a bearer token that opens the tier catalog is never at rest
 * where any script on this origin can read it, and signing out of Keycloak signs
 * you out here rather than leaving a token that outlives the session it came from.
 *
 * There is no refresh token handling for the same reason — nothing survives the
 * page. An expired token shows up as a `401` from our own API, and the answer to
 * that is to sign in again, which is one redirect.
 *
 * <h2>What does survive the redirect</h2>
 *
 * Exactly three strings, in `sessionStorage`, for the seconds between leaving for
 * Keycloak and coming back: the PKCE verifier, the `state`, and where the operator
 * was going. They have to outlive the page because the page is destroyed by the
 * navigation, and they are cleared the moment the code is exchanged — kept longer,
 * a stale verifier would silently fail the next sign-in that reused it.
 */
export interface AdminSession {
  accessToken: string;
  /**
   * The realm roles the token carries, **for the screen and never for the
   * security**. The API enforces `ADMIN` on every route under `/api/admin` (#27),
   * so this decides whether somebody sees a catalog or is told they are signed in
   * as the wrong person. A build that lied to itself here would show empty tables
   * and a row of `403`s.
   */
  roles: string[];
  /** When the token stops working, as the token itself says. Epoch milliseconds. */
  expiresAt: number;
}

export function isOperator(session: AdminSession): boolean {
  return session.roles.includes(ADMIN_ROLE);
}

/**
 * What a page load turned out to be.
 *
 * `not-a-sign-in` is the ordinary case — somebody typed `/admin`, or reloaded —
 * and is not a failure. `failed` is: the `state` did not match, the code was
 * refused, or the realm could not be reached, each of which the operator has to be
 * told about rather than being bounced round the sign-in loop again.
 */
export type Arrival =
  | { status: "signed-in"; session: AdminSession; returnTo: string }
  | { status: "not-a-sign-in" }
  | { status: "failed"; message: string };

/** What `sessionStorage` holds between leaving for Keycloak and coming back. */
const IN_FLIGHT = "mprelist.admin.sign-in";

/**
 * How a sign-in differs by who started it (T85). The customer session on `/`
 * runs this same exchange against the same client, and the realm sends both back
 * to the origin root — so each keeps its own in-flight record under its own key,
 * which is how `/` tells a returning buyer from a returning operator. `prompt`
 * is `none` for the customer's silent check on load: Keycloak answers from its
 * own session, or with `login_required`, and never shows a page.
 */
export interface SignInOptions {
  key?: string;
  prompt?: "none";
}

interface InFlight {
  verifier: string;
  state: string;
  returnTo: string;
}

/**
 * Send the browser to Keycloak.
 *
 * The navigation is handed in rather than performed, so that what this builds can
 * be asserted without a browser leaving the page — which is the whole of what is
 * worth testing here, since a `code_challenge` that does not match the verifier
 * fails at the token endpoint minutes later with a message about neither.
 */
export async function beginSignIn(
  config: AdminConfig,
  http: Http,
  storage: Storage,
  navigate: (url: string) => void,
  returnTo: string,
  options: SignInOptions = {},
): Promise<void> {
  const endpoints = await fetchOidcEndpoints(config.issuer, http);
  const verifier = createVerifier();
  const state = createState();
  storage.setItem(
    options.key ?? IN_FLIGHT,
    JSON.stringify({ verifier, state, returnTo } satisfies InFlight),
  );

  const authorize = new URL(endpoints.authorizationEndpoint);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", config.redirectUri);
  authorize.searchParams.set("scope", config.scope);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", await challengeFor(verifier));
  // S256 and never `plain`: the realm requires it of this client, and a `plain`
  // challenge is the verifier itself travelling in the URL, which is no protection.
  authorize.searchParams.set("code_challenge_method", "S256");
  if (options.prompt) authorize.searchParams.set("prompt", options.prompt);
  navigate(authorize.toString());
}

/**
 * Finish a sign-in this page was redirected back into, if it was.
 *
 * The query string is read rather than `location`, so the decision is a function
 * of its input — and the caller is the one file that touches the document.
 */
export async function completeSignIn(
  search: string,
  config: AdminConfig,
  http: Http,
  storage: Storage,
  key: string = IN_FLIGHT,
): Promise<Arrival> {
  const params = new URLSearchParams(search);
  const error = params.get("error");
  const code = params.get("code");
  const state = params.get("state");

  if (error) {
    // Keycloak refusing is a sentence it wrote, and it names what is misconfigured
    // better than anything invented here would.
    storage.removeItem(key);
    return { status: "failed", message: params.get("error_description") ?? error };
  }
  if (!code || !state) return { status: "not-a-sign-in" };

  const inFlight = readInFlight(storage, key);
  storage.removeItem(key);
  if (!inFlight) {
    return { status: "failed", message: "This sign-in did not start in this tab. Try again." };
  }
  if (inFlight.state !== state) {
    // The one thing tying this redirect to the request we made. A mismatch is
    // either a stale tab or somebody else's code, and neither is worth exchanging.
    return { status: "failed", message: "That sign-in did not match the one this tab started." };
  }

  let endpoints;
  try {
    endpoints = await fetchOidcEndpoints(config.issuer, http);
  } catch (unreachable) {
    return { status: "failed", message: messageOf(unreachable) };
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: inFlight.verifier,
  });

  let response: Response;
  try {
    response = await http(endpoints.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    return { status: "failed", message: "Could not reach the sign-in server to finish signing in." };
  }

  const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !answer) {
    const described = answer && typeof answer["error_description"] === "string"
      ? (answer["error_description"] as string)
      : `The sign-in server answered ${response.status}.`;
    return { status: "failed", message: described };
  }

  const accessToken = answer["access_token"];
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return { status: "failed", message: "The sign-in server sent no access token." };
  }

  return {
    status: "signed-in",
    session: {
      accessToken,
      roles: realmRolesIn(accessToken),
      expiresAt: expiryOf(answer, accessToken),
    },
    returnTo: inFlight.returnTo,
  };
}

/**
 * Send the browser to Keycloak to end the session there, not just here.
 *
 * **Needed to walk slice D at all, and not a courtesy.** The token lives only in
 * this page, so "forget it" would be one line — but forgetting it and reloading
 * signs the same person straight back in, because Keycloak's own SSO cookie is
 * still good. The screen that most needs this is `not-an-operator`: somebody
 * signed in as the wrong user is otherwise trapped there with no way to become the
 * right one, which is exactly what the click-through's step 2 does on purpose.
 *
 * `client_id` plus `post_logout_redirect_uri` rather than an `id_token_hint`: the
 * realm sets `post.logout.redirect.uris` to `+`, which means its registered
 * redirect URIs, and this one is registered because signing *in* needs it.
 */
export async function signOut(
  config: AdminConfig,
  http: Http,
  navigate: (url: string) => void,
): Promise<void> {
  const endpoints = await fetchOidcEndpoints(config.issuer, http);
  if (!endpoints.endSessionEndpoint) {
    // Nothing to navigate to; the caller has already dropped the token, which is
    // the whole of what this page was holding.
    navigate(config.redirectUri);
    return;
  }
  const logout = new URL(endpoints.endSessionEndpoint);
  logout.searchParams.set("client_id", config.clientId);
  logout.searchParams.set("post_logout_redirect_uri", config.redirectUri);
  navigate(logout.toString());
}

/**
 * The realm roles an access token carries.
 *
 * **Read without verifying the signature, and that is safe because nothing here is
 * a decision.** This API's tokens are verified by the API, which is the only place
 * a role opens anything (#27, #19). What this decides is which screen an operator
 * is shown — and a forged token would buy somebody a table full of `403`s.
 */
export function realmRolesIn(accessToken: string): string[] {
  const claims = claimsIn(accessToken);
  const realmAccess = claims?.["realm_access"];
  if (typeof realmAccess !== "object" || realmAccess === null) return [];
  const roles = (realmAccess as Record<string, unknown>)["roles"];
  return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === "string") : [];
}

/**
 * When the token stops working — the token's own `exp` first, and the response's
 * `expires_in` only if it has none.
 *
 * The claim wins because it is what the API checks against; `expires_in` is
 * relative to a clock that is not the issuer's.
 */
function expiryOf(answer: Record<string, unknown>, accessToken: string): number {
  const exp = claimsIn(accessToken)?.["exp"];
  if (typeof exp === "number") return exp * 1000;
  const expiresIn = answer["expires_in"];
  return Date.now() + (typeof expiresIn === "number" ? expiresIn : 60) * 1000;
}

/** A JWT's payload, or nothing where it is not one. Never throws — the caller has a screen. */
function claimsIn(accessToken: string): Record<string, unknown> | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replaceAll("-", "+").replaceAll("_", "/"));
    const claims = JSON.parse(json) as unknown;
    return typeof claims === "object" && claims !== null ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readInFlight(storage: Storage, key: string): InFlight | null {
  const stored = storage.getItem(key);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<InFlight>;
    return typeof parsed.verifier === "string" && typeof parsed.state === "string"
      ? { verifier: parsed.verifier, state: parsed.state, returnTo: parsed.returnTo ?? "/admin" }
      : null;
  } catch {
    return null;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
