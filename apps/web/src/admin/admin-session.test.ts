import { describe, expect, it } from "vitest";

import { DEFAULT_ADMIN_CONFIG } from "./admin-config";
import { beginSignIn, completeSignIn, isOperator, realmRolesIn } from "./admin-session";
import type { Http } from "./discovery";
import { discoveryDocument, inMemoryStorage, json, tokenFor } from "./testing";

const CONFIG = DEFAULT_ADMIN_CONFIG;
const ISSUER = CONFIG.issuer;

interface Call {
  url: string;
  init?: RequestInit;
}

/** A Keycloak that answers discovery, and whatever the test says at the token endpoint. */
function keycloak(token: () => Response = () => json({ access_token: tokenFor(["ADMIN"]) })) {
  const calls: Call[] = [];
  const http: Http = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/.well-known/")) return json(discoveryDocument(ISSUER));
    return token();
  };
  return { http, calls };
}

describe("starting a sign-in", () => {
  it("sends the browser to the realm's own authorization endpoint", async () => {
    const { http } = keycloak();
    const storage = inMemoryStorage();
    let sentTo = "";

    await beginSignIn(CONFIG, http, storage, (url) => void (sentTo = url), "/admin");

    // Read from the discovery document rather than composed, so a realm that moves
    // its paths is a configuration change rather than a rewrite.
    expect(sentTo.startsWith(`${ISSUER}/protocol/openid-connect/auth`)).toBe(true);
  });

  it("asks for a code, as the client the realm has defined since #15", async () => {
    const { http } = keycloak();
    let sentTo = "";

    await beginSignIn(CONFIG, http, inMemoryStorage(), (url) => void (sentTo = url), "/admin");
    const params = new URL(sentTo).searchParams;

    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe("mprelist-dashboard");
    expect(params.get("scope")).toBe("openid");
  });

  it("names the one redirect URI the realm registered", async () => {
    // Keycloak matches exactly — `KeycloakRealmTest` proves a path beneath it is
    // refused with a page rather than a redirect — and the realm imports on first
    // start only, so getting this wrong is a `down -v` rather than an edit.
    const { http } = keycloak();
    let sentTo = "";

    await beginSignIn(CONFIG, http, inMemoryStorage(), (url) => void (sentTo = url), "/admin");

    expect(new URL(sentTo).searchParams.get("redirect_uri")).toBe("http://localhost:5173/");
  });

  it("carries a challenge and never the verifier", async () => {
    // The whole of PKCE: a code intercepted on the way back is worthless without
    // the verifier, which never leaves this tab until the exchange.
    const { http } = keycloak();
    const storage = inMemoryStorage();
    let sentTo = "";

    await beginSignIn(CONFIG, http, storage, (url) => void (sentTo = url), "/admin");
    const params = new URL(sentTo).searchParams;
    const inFlight = JSON.parse(storage.getItem("mprelist.admin.sign-in") ?? "{}") as {
      verifier: string;
    };

    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBeTruthy();
    expect(params.get("code_challenge")).not.toBe(inFlight.verifier);
    expect(sentTo).not.toContain(inFlight.verifier);
  });

  it("remembers the state it sent and where the operator was going", async () => {
    const { http } = keycloak();
    const storage = inMemoryStorage();
    let sentTo = "";

    await beginSignIn(CONFIG, http, storage, (url) => void (sentTo = url), "/admin");
    const stored = JSON.parse(storage.getItem("mprelist.admin.sign-in") ?? "{}") as {
      state: string;
      returnTo: string;
    };

    expect(new URL(sentTo).searchParams.get("state")).toBe(stored.state);
    expect(stored.returnTo).toBe("/admin");
  });
});

describe("coming back from the realm", () => {
  /** The round trip, driven end to end through the two halves that make it one. */
  async function roundTrip(options: { token?: () => Response; tamper?: (state: string) => string } = {}) {
    const { http, calls } = keycloak(options.token);
    const storage = inMemoryStorage();
    let sentTo = "";
    await beginSignIn(CONFIG, http, storage, (url) => void (sentTo = url), "/admin");
    const state = new URL(sentTo).searchParams.get("state") ?? "";
    const search = `?code=an-authorization-code&state=${options.tamper ? options.tamper(state) : state}`;
    return { arrival: await completeSignIn(search, CONFIG, http, storage), calls, storage };
  }

  it("exchanges the code for a token, with the verifier it kept", async () => {
    const { arrival, calls } = await roundTrip();

    expect(arrival.status).toBe("signed-in");
    const exchange = calls.at(-1);
    const body = new URLSearchParams(String(exchange?.init?.body));
    expect(exchange?.init?.method).toBe("POST");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("an-authorization-code");
    expect(body.get("code_verifier")).toBeTruthy();
    // A public client has no secret to send, which is what PKCE replaces.
    expect(body.get("client_secret")).toBeNull();
  });

  it("and hands back the roles the token carries, for the screen", async () => {
    const { arrival } = await roundTrip();

    expect(arrival.status === "signed-in" && isOperator(arrival.session)).toBe(true);
    expect(arrival.status === "signed-in" && arrival.session.roles).toContain("ADMIN");
  });

  it("and where the operator was going, which the redirect URI could not carry", async () => {
    const { arrival } = await roundTrip();

    expect(arrival.status === "signed-in" && arrival.returnTo).toBe("/admin");
  });

  it("and forgets the verifier, so the next sign-in mints its own", async () => {
    // Kept, a stale verifier would silently fail whichever exchange reused it.
    const { storage } = await roundTrip();

    expect(storage.getItem("mprelist.admin.sign-in")).toBeNull();
  });

  it("refuses a state that is not the one this tab sent", async () => {
    // The one thing tying the redirect to the request we made. A mismatch is a
    // stale tab or somebody else's code, and neither is worth exchanging.
    const { arrival, calls } = await roundTrip({ tamper: () => "somebody-elses-state" });

    expect(arrival.status).toBe("failed");
    // And nothing was exchanged: only the discovery calls were made.
    expect(calls.every((call) => call.url.includes("/.well-known/"))).toBe(true);
  });

  it("and a sign-in that did not start in this tab at all", async () => {
    const { http } = keycloak();

    const arrival = await completeSignIn("?code=abc&state=xyz", CONFIG, http, inMemoryStorage());

    expect(arrival.status).toBe("failed");
  });

  it("reads a page load that is not a redirect as exactly that", async () => {
    // The ordinary case: somebody typed `/admin`, or reloaded. Not a failure.
    const { http } = keycloak();

    const arrival = await completeSignIn("", CONFIG, http, inMemoryStorage());

    expect(arrival).toEqual({ status: "not-a-sign-in" });
  });

  it("passes on the realm's own words when it refuses", async () => {
    // Keycloak names what is misconfigured better than anything invented here —
    // `invalid_redirect_uri` is the one an operator will actually meet.
    const { http } = keycloak();

    const arrival = await completeSignIn(
      "?error=invalid_redirect_uri&error_description=Invalid+parameter%3A+redirect_uri",
      CONFIG,
      http,
      inMemoryStorage(),
    );

    expect(arrival).toEqual({ status: "failed", message: "Invalid parameter: redirect_uri" });
  });

  it("and says so when the token endpoint refuses the code", async () => {
    const { arrival } = await roundTrip({
      token: () => json({ error: "invalid_grant", error_description: "Code not valid" }, 400),
    });

    expect(arrival).toEqual({ status: "failed", message: "Code not valid" });
  });

  it("and when the answer carries no token at all", async () => {
    const { arrival } = await roundTrip({ token: () => json({ token_type: "Bearer" }) });

    expect(arrival.status).toBe("failed");
  });
});

describe("the realm the build is pointed at", () => {
  it("has to be the one the discovery document says it is", async () => {
    // One stale port or one wrong realm name and every token is minted by an
    // issuer our own API refuses — which presents as a `401` from the backend long
    // after the sign-in that caused it looked fine.
    const http: Http = async () => json(discoveryDocument("http://localhost:8081/realms/somebody-else"));

    await expect(
      beginSignIn(CONFIG, http, inMemoryStorage(), () => {}, "/admin"),
    ).rejects.toThrow(/belongs to/);
  });

  it("and being unreachable says which URL, because that is the whole diagnosis", async () => {
    const http: Http = async () => {
      throw new TypeError("Failed to fetch");
    };

    await expect(
      beginSignIn(CONFIG, http, inMemoryStorage(), () => {}, "/admin"),
    ).rejects.toThrow(/\.well-known\/openid-configuration/);
  });
});

describe("reading roles off a token", () => {
  it("takes the realm roles and nothing else", () => {
    expect(realmRolesIn(tokenFor(["ADMIN", "SUPPORT"]))).toEqual(["ADMIN", "SUPPORT"]);
  });

  it("answers none for a token that carries none, rather than throwing", () => {
    // A screen has to render either way. Every failure here is "not an operator",
    // which is the fail-closed direction.
    expect(realmRolesIn("not-a-jwt")).toEqual([]);
    expect(realmRolesIn("")).toEqual([]);
    expect(realmRolesIn(tokenFor([]))).toEqual([]);
  });
});
