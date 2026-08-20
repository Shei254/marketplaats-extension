import { describe, expect, it } from "vitest";

import { Authenticator } from "./authenticator";
import { DEFAULT_AUTH_CONFIG } from "./auth-config";
import {
  FakeBrowserAuthFlow,
  FakeHttp,
  InMemorySessionStore,
  ISSUER,
  TOKEN_ENDPOINT,
  json,
  tokenResponse,
  type FakeHttpRoutes,
} from "./testing/fakes";
import type { AuthSession } from "./session";

/**
 * Refresh (T24, #33): a token good enough to send now, renewed on the way if it
 * is not, and never on a timer — an MV3 worker is evicted between one relist and
 * the next, so a timer set now is one that will not be there later.
 *
 * The three answers are the subject rather than a detail. "You are signed out"
 * and "we could not reach Keycloak" lead to different screens and only one of
 * them ends a session, and this suite is mostly about keeping them apart.
 */
const NOW = 1_755_000_000_000;

const SIGNED_IN: AuthSession = {
  accessToken: "an-access-token",
  refreshToken: "a-refresh-token",
  idToken: "an-id-token",
  expiresAt: NOW + 300_000,
  obtainedAt: NOW,
};

/** The same session, with its access token past it. */
const STALE: AuthSession = { ...SIGNED_IN, expiresAt: NOW - 60_000, obtainedAt: NOW - 360_000 };

function authenticator(session: AuthSession | null, routes: FakeHttpRoutes = {}) {
  const http = new FakeHttp(routes);
  const store = new InMemorySessionStore(session);
  const auth = new Authenticator({
    flow: new FakeBrowserAuthFlow(),
    store,
    http: http.fetch,
    config: { ...DEFAULT_AUTH_CONFIG, issuer: ISSUER },
    now: () => NOW,
  });
  return { auth, http, store };
}

describe("a token that is still good", () => {
  it("is handed back without asking Keycloak anything", async () => {
    const { auth, http } = authenticator(SIGNED_IN);

    await expect(auth.accessToken()).resolves.toEqual({
      status: "ready",
      token: "an-access-token",
    });
    expect(http.calls).toHaveLength(0);
  });

  it("is one with more than the margin left, and not one with less", async () => {
    // The margin is what stops a token expiring between this check and the server
    // reading it. Both sides of it, so the check is a boundary rather than a
    // direction.
    const { auth: comfortable, http: quiet } = authenticator({ ...SIGNED_IN, expiresAt: NOW + 31_000 });
    const { auth: nearlyOut, http: busy } = authenticator({ ...SIGNED_IN, expiresAt: NOW + 29_000 });

    await comfortable.accessToken();
    await nearlyOut.accessToken();

    expect(quiet.callsTo(TOKEN_ENDPOINT)).toHaveLength(0);
    expect(busy.callsTo(TOKEN_ENDPOINT)).toHaveLength(1);
  });
});

describe("a token that is past it", () => {
  it("is renewed with the refresh token, as this client", async () => {
    const { auth, http } = authenticator(STALE);

    await expect(auth.accessToken()).resolves.toEqual({ status: "ready", token: "an-access-token" });

    const refresh = http.callsTo(TOKEN_ENDPOINT)[0];
    expect(refresh?.method).toBe("POST");
    expect(refresh?.form.get("grant_type")).toBe("refresh_token");
    expect(refresh?.form.get("refresh_token")).toBe("a-refresh-token");
    expect(refresh?.form.get("client_id")).toBe("mprelist-extension");
  });

  it("leaves the rotated refresh token behind it, not the spent one", async () => {
    // The realm revokes on use and allows no reuse, so the old one is gone the
    // moment this call succeeds. A store that kept it would present it next time
    // and end the session.
    const { auth, store } = authenticator(STALE, {
      token: () => tokenResponse({ access_token: "a-newer-token", refresh_token: "a-newer-refresh" }),
    });

    await auth.accessToken();

    expect(store.session).toEqual({
      accessToken: "a-newer-token",
      refreshToken: "a-newer-refresh",
      idToken: "an-id-token",
      expiresAt: NOW + 300_000,
      obtainedAt: NOW,
    });
  });

  it("keeps the id token when the answer does not carry one", async () => {
    // It is only ever the `id_token_hint` that ends the Keycloak session at
    // sign-out. Dropping it here surfaces hours later, in another feature, as
    // "signing in again never asks who I am".
    const { auth, store } = authenticator(STALE, {
      token: () => tokenResponse({ id_token: undefined }),
    });

    await auth.accessToken();

    expect(store.session?.idToken).toBe("an-id-token");
  });

  it("keeps the refresh token when the answer does not carry a new one", async () => {
    // RFC 6749 §6: the old one stays valid if none is issued. Keycloak always
    // issues one under this realm's settings, which is exactly why the case is
    // worth pinning rather than assuming.
    const { auth, store } = authenticator(STALE, {
      token: () => tokenResponse({ refresh_token: undefined }),
    });

    await auth.accessToken();

    expect(store.session?.refreshToken).toBe("a-refresh-token");
  });
});

describe("two callers waking at the same moment", () => {
  it("share one refresh, because the second would spend a token the first retired", async () => {
    // `revokeRefreshToken` with `refreshTokenMaxReuse: 0` (infra/README.md): the
    // answer to a second concurrent refresh is not a slow call, it is the session
    // ending.
    const { auth, http } = authenticator(STALE, {
      token: () => tokenResponse({ access_token: "a-newer-token" }),
    });

    const [first, second] = await Promise.all([auth.accessToken(), auth.accessToken()]);

    expect(http.callsTo(TOKEN_ENDPOINT)).toHaveLength(1);
    expect(first).toEqual({ status: "ready", token: "a-newer-token" });
    expect(second).toEqual(first);
  });

  it("and a caller arriving afterwards uses what they left, rather than refreshing again", async () => {
    const { auth, http } = authenticator(STALE, {
      token: () => tokenResponse({ access_token: "a-newer-token" }),
    });

    await auth.accessToken();
    await expect(auth.accessToken()).resolves.toEqual({ status: "ready", token: "a-newer-token" });

    expect(http.callsTo(TOKEN_ENDPOINT)).toHaveLength(1);
  });

  it("and one arriving after a failure tries again rather than inheriting it", async () => {
    // The in-flight promise is dropped when it settles, however it settles: a memo
    // that kept a rejection would leave one bad minute poisoning the worker until
    // it happened to be evicted.
    let reachable = false;
    const { auth, http } = authenticator(STALE, {
      token: () => {
        if (!reachable) throw new TypeError("Failed to fetch");
        return tokenResponse();
      },
    });

    await expect(auth.accessToken()).resolves.toEqual({ status: "unavailable" });
    reachable = true;
    await expect(auth.accessToken()).resolves.toEqual({ status: "ready", token: "an-access-token" });

    expect(http.callsTo(TOKEN_ENDPOINT)).toHaveLength(2);
  });
});

describe("when the session is over", () => {
  it("says so, and forgets it, when Keycloak calls the grant invalid", async () => {
    // `invalid_grant` is the one error that means the refresh token itself is
    // spent, expired or revoked (RFC 6749 §5.2). Nothing can be done with this
    // session again, so it is not kept.
    const { auth, store } = authenticator(STALE, {
      token: () => json({ error: "invalid_grant", error_description: "Token is not active" }, 400),
    });

    await expect(auth.accessToken()).resolves.toEqual({ status: "signed-out" });
    expect(store.session).toBeNull();
  });

  it("says so when there is no session at all, and asks Keycloak nothing", async () => {
    const { auth, http } = authenticator(null);

    await expect(auth.accessToken()).resolves.toEqual({ status: "signed-out" });
    expect(http.calls).toHaveLength(0);
  });

  it("says so when a stale session has nothing to renew with", async () => {
    const { auth, store, http } = authenticator({ ...STALE, refreshToken: null });

    await expect(auth.accessToken()).resolves.toEqual({ status: "signed-out" });
    expect(store.session).toBeNull();
    expect(http.calls).toHaveLength(0);
  });
});

describe("when it is Keycloak that is unavailable, not the session", () => {
  it("keeps the session when the token endpoint cannot be reached", async () => {
    // A flaky minute must not sign anybody out of a session that is still good.
    const { auth, store } = authenticator(STALE, {
      token: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await expect(auth.accessToken()).resolves.toEqual({ status: "unavailable" });
    expect(store.session).toEqual(STALE);
  });

  it("keeps it when the realm cannot be discovered either", async () => {
    const { auth, store } = authenticator(STALE, {
      discovery: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await expect(auth.accessToken()).resolves.toEqual({ status: "unavailable" });
    expect(store.session).toEqual(STALE);
  });

  it("keeps it when Keycloak answers with a server error", async () => {
    const { auth, store } = authenticator(STALE, {
      token: () => json({ error: "server_error" }, 503),
    });

    await expect(auth.accessToken()).resolves.toEqual({ status: "unavailable" });
    expect(store.session).toEqual(STALE);
  });

  it("keeps it when this build is the thing that is misconfigured", async () => {
    // `invalid_client` is a wrong client id — our deploy, not the user's session.
    // Clearing every session over it would turn a one-line fix into a
    // re-sign-in for everybody who was logged in when it shipped.
    const { auth, store } = authenticator(STALE, {
      token: () => json({ error: "invalid_client" }, 401),
    });

    await expect(auth.accessToken()).resolves.toEqual({ status: "unavailable" });
    expect(store.session).toEqual(STALE);
  });

  it("keeps it when a 200 carries no usable token", async () => {
    const { auth, store } = authenticator(STALE, {
      token: () => tokenResponse({ access_token: undefined }),
    });

    await expect(auth.accessToken()).resolves.toEqual({ status: "unavailable" });
    expect(store.session).toEqual(STALE);
  });
});

describe("what the popup is told meanwhile", () => {
  it("is still signed in while a refresh is only failing to reach Keycloak", async () => {
    // The display state is read from storage, which an unreachable IdP does not
    // touch — so the popup keeps saying signed in while the call it wanted the
    // token for fails closed. Those are the two right answers, not a disagreement.
    const { auth } = authenticator(STALE, {
      token: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await auth.accessToken();

    await expect(auth.state()).resolves.toEqual({ status: "signed-in", expiresAt: STALE.expiresAt });
  });

  it("and signed out once the refresh token has been refused", async () => {
    const { auth } = authenticator(STALE, {
      token: () => json({ error: "invalid_grant" }, 400),
    });

    await auth.accessToken();

    await expect(auth.state()).resolves.toEqual({ status: "signed-out" });
  });
});
