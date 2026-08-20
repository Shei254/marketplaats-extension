import { describe, expect, it } from "vitest";

import { Authenticator } from "./authenticator";
import { DEFAULT_AUTH_CONFIG } from "./auth-config";
import { SignInCancelledError, SignInFailedError } from "./errors";
import { challengeFor } from "./pkce";
import {
  AUTHORIZATION_ENDPOINT,
  END_SESSION_ENDPOINT,
  FakeBrowserAuthFlow,
  FakeHttp,
  InMemorySessionStore,
  ISSUER,
  TOKEN_ENDPOINT,
  discoveryDocument,
  json,
  tokenResponse,
  type FakeHttpRoutes,
} from "./testing/fakes";
import type { LaunchOutcome } from "./browser-flow";
import type { AuthSession } from "./session";

const NOW = 1_755_000_000_000;

function authenticator(options: {
  answer?: (url: URL) => LaunchOutcome;
  routes?: FakeHttpRoutes;
  session?: AuthSession | null;
} = {}) {
  const flow = new FakeBrowserAuthFlow(options.answer);
  const http = new FakeHttp(options.routes);
  const store = new InMemorySessionStore(options.session ?? null);
  const auth = new Authenticator({
    flow,
    store,
    http: http.fetch,
    config: { ...DEFAULT_AUTH_CONFIG, issuer: ISSUER },
    now: () => NOW,
  });
  return { auth, flow, http, store };
}

describe("signing in", () => {
  it("asks Keycloak for a code, and asks as the client the realm knows", async () => {
    const { auth, flow } = authenticator();

    await auth.signIn();

    const url = flow.authorizeUrl;
    expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZATION_ENDPOINT);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("mprelist-extension");
    expect(url.searchParams.get("redirect_uri")).toBe("https://extension-id.chromiumapp.org/");
    expect(flow.launches[0]?.interactive).toBe(true);
  });

  it("sends the challenge and keeps the verifier, and the two are the same secret", async () => {
    // The point of PKCE, asserted end to end rather than per-half: the value the
    // browser was shown has to be the SHA-256 of the value the token request
    // carries. Two halves each tested alone can both pass while the pair does not.
    const { auth, flow, http } = authenticator();

    await auth.signIn();

    const challenge = flow.authorizeUrl.searchParams.get("code_challenge");
    const verifier = http.callsTo(TOKEN_ENDPOINT)[0]?.form.get("code_verifier");
    expect(flow.authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(verifier).toBeTruthy();
    expect(challenge).toBe(await challengeFor(verifier ?? ""));
  });

  it("never puts the verifier in the URL the browser is given", async () => {
    const { auth, flow, http } = authenticator();

    await auth.signIn();

    const verifier = http.callsTo(TOKEN_ENDPOINT)[0]?.form.get("code_verifier") ?? "";
    expect(flow.authorizeUrl.toString()).not.toContain(verifier);
  });

  it("asks for `openid` and nothing else", async () => {
    // Keycloak's default scopes would put a name and an email in the token we send
    // to our own API, which ADR-0001/0005 draw the boundary against.
    const { auth, flow } = authenticator();

    await auth.signIn();

    expect(flow.authorizeUrl.searchParams.get("scope")).toBe("openid");
  });

  it("exchanges the code with the same redirect URI it asked with", async () => {
    const { auth, http } = authenticator();

    await auth.signIn();

    const exchange = http.callsTo(TOKEN_ENDPOINT)[0];
    expect(exchange?.method).toBe("POST");
    expect(exchange?.form.get("grant_type")).toBe("authorization_code");
    expect(exchange?.form.get("code")).toBe("test-code");
    expect(exchange?.form.get("client_id")).toBe("mprelist-extension");
    // Keycloak compares this with the one the authorize request carried and
    // refuses the exchange if they differ.
    expect(exchange?.form.get("redirect_uri")).toBe("https://extension-id.chromiumapp.org/");
  });

  it("stores the session, with the access token's expiry worked out from now", async () => {
    const { auth, store } = authenticator();

    const state = await auth.signIn();

    expect(store.session).toEqual({
      accessToken: "an-access-token",
      refreshToken: "a-refresh-token",
      idToken: "an-id-token",
      expiresAt: NOW + 300_000,
      obtainedAt: NOW,
    });
    expect(state).toEqual({ status: "signed-in", expiresAt: NOW + 300_000 });
  });
});

describe("signing in, when it does not work", () => {
  it("says a closed window was cancelled, not that something broke", async () => {
    const { auth, store } = authenticator({
      answer: () => ({ ok: false, reason: "cancelled", message: "The user did not approve access." }),
    });

    await expect(auth.signIn()).rejects.toBeInstanceOf(SignInCancelledError);
    expect(store.session).toBeNull();
  });

  it("refuses a redirect that does not carry this request's state, and spends nothing", async () => {
    // Not this request's answer, so it is not read for anything — the code it
    // carries is never presented, which is the whole reason `state` exists.
    const { auth, http, store } = authenticator({
      answer: () => ({
        ok: true,
        redirectedTo: "https://extension-id.chromiumapp.org/?code=somebody-elses&state=not-ours",
      }),
    });

    await expect(auth.signIn()).rejects.toThrow(/does not belong to this sign-in/);
    expect(http.callsTo(TOKEN_ENDPOINT)).toHaveLength(0);
    expect(store.session).toBeNull();
  });

  it("repeats what Keycloak said when Keycloak refused at the window", async () => {
    const { auth } = authenticator({
      answer: (url) => ({
        ok: true,
        redirectedTo: `https://extension-id.chromiumapp.org/?error=access_denied&error_description=Consent+denied&state=${url.searchParams.get("state")}`,
      }),
    });

    await expect(auth.signIn()).rejects.toThrow(/Consent denied/);
  });

  it("repeats what Keycloak said when Keycloak refused the exchange", async () => {
    const { auth, store } = authenticator({
      routes: { token: () => json({ error: "invalid_grant", error_description: "Code not valid" }, 400) },
    });

    await expect(auth.signIn()).rejects.toThrow(/Code not valid/);
    expect(store.session).toBeNull();
  });

  it("stores nothing when a 200 carries no access token", async () => {
    // A session whose access token is `undefined` is a signed-in state that
    // cannot do anything — worse than a sign-in that failed.
    const { auth, store } = authenticator({
      routes: { token: () => tokenResponse({ access_token: undefined }) },
    });

    await expect(auth.signIn()).rejects.toThrow(/no access token/);
    expect(store.session).toBeNull();
  });

  it("stores nothing when the answer does not say when the token expires", async () => {
    const { auth, store } = authenticator({
      routes: { token: () => tokenResponse({ expires_in: undefined }) },
    });

    await expect(auth.signIn()).rejects.toThrow(/when the access token expires/);
    expect(store.session).toBeNull();
  });

  it("opens no window at all when the realm is unreachable", async () => {
    const { auth, flow } = authenticator({
      routes: {
        discovery: () => {
          throw new TypeError("Failed to fetch");
        },
      },
    });

    await expect(auth.signIn()).rejects.toThrow(/Could not reach the sign-in server/);
    expect(flow.launches).toHaveLength(0);
  });

  it("opens no window when the discovery document belongs to another realm", async () => {
    // One stale port and every token is minted by an issuer our API refuses — a
    // 401 from our own backend, a long way from the config line that caused it.
    const { auth, flow } = authenticator({
      routes: { discovery: () => discoveryDocument({ issuer: "http://localhost:8081/realms/other" }) },
    });

    await expect(auth.signIn()).rejects.toThrow(/not to the realm this build is configured for/);
    expect(flow.launches).toHaveLength(0);
  });
});

describe("the discovery document", () => {
  it("is fetched once, however many callers wake at the same moment", async () => {
    const { auth, http } = authenticator();

    await Promise.all([auth.signIn(), auth.signIn()]);

    expect(http.discoveryCalls).toHaveLength(1);
  });

  it("is not remembered when it failed", async () => {
    // A memo that kept the rejection would leave one unreachable realm poisoning
    // every later attempt until the worker happened to be evicted.
    let reachable = false;
    const { auth, http } = authenticator({
      routes: {
        discovery: () => {
          if (!reachable) throw new TypeError("Failed to fetch");
          return discoveryDocument();
        },
      },
    });

    await expect(auth.signIn()).rejects.toThrow(/Could not reach/);
    reachable = true;
    await auth.signIn();

    expect(http.discoveryCalls).toHaveLength(2);
  });
});

describe("signing out", () => {
  const signedIn: AuthSession = {
    accessToken: "an-access-token",
    refreshToken: "a-refresh-token",
    idToken: "an-id-token",
    expiresAt: NOW + 300_000,
    obtainedAt: NOW,
  };

  it("ends the Keycloak session, quietly, with the id token as the hint", async () => {
    const { auth, flow } = authenticator({ session: signedIn });

    await auth.signOut();

    const logout = flow.launches.at(-1);
    expect(`${logout?.url.origin}${logout?.url.pathname}`).toBe(END_SESSION_ENDPOINT);
    expect(logout?.url.searchParams.get("id_token_hint")).toBe("an-id-token");
    expect(logout?.url.searchParams.get("post_logout_redirect_uri")).toBe(
      "https://extension-id.chromiumapp.org/",
    );
    // Nobody asked to look at a browser window; with a valid hint there is
    // nothing to show.
    expect(logout?.interactive).toBe(false);
  });

  it("clears the session before it tries, so a failure there still signs you out", async () => {
    const { auth, store } = authenticator({
      session: signedIn,
      answer: () => ({ ok: false, reason: "failed", message: "Authorization page could not be loaded." }),
    });

    await expect(auth.signOut()).resolves.toEqual({ status: "signed-out" });
    expect(store.session).toBeNull();
    expect(store.clears).toBe(1);
  });

  it("still signs you out when the realm cannot be reached at all", async () => {
    const { auth, store } = authenticator({
      session: signedIn,
      routes: {
        discovery: () => {
          throw new TypeError("Failed to fetch");
        },
      },
    });

    await expect(auth.signOut()).resolves.toEqual({ status: "signed-out" });
    expect(store.session).toBeNull();
  });

  it("launches nothing when there was no session to end", async () => {
    const { auth, flow } = authenticator();

    await auth.signOut();

    expect(flow.launches).toHaveLength(0);
  });
});

describe("the state a caller is told", () => {
  it("is signed out with nothing stored", async () => {
    const { auth } = authenticator();
    await expect(auth.state()).resolves.toEqual({ status: "signed-out" });
  });

  it("is signed in while a session is held, even once its access token is stale", async () => {
    // Access tokens last five minutes and an MV3 worker sleeps for longer between
    // one relist and the next. A state that flipped on expiry would flap for every
    // user who left the popup closed; making a stale token usable is refresh,
    // which is T24 (#33).
    const { auth } = authenticator({
      session: {
        accessToken: "an-old-token",
        refreshToken: "a-refresh-token",
        idToken: null,
        expiresAt: NOW - 60_000,
        obtainedAt: NOW - 360_000,
      },
    });

    await expect(auth.state()).resolves.toEqual({ status: "signed-in", expiresAt: NOW - 60_000 });
  });
});

describe("what is never said out loud", () => {
  it("keeps tokens out of the error a failed sign-in throws", async () => {
    const { auth } = authenticator({
      routes: { token: () => json({ error: "invalid_grant", access_token: "leaked" }, 400) },
    });

    await expect(auth.signIn()).rejects.toThrow(/invalid_grant/);
    await expect(auth.signIn()).rejects.not.toThrow(/leaked/);
  });
});
