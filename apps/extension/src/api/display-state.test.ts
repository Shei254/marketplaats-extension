import type { DisplayState } from "@mprelist/contracts";
import { describe, expect, it } from "vitest";

import type { AccessToken } from "../auth/session";
import { MprelistApi, asDisplayState, type DisplayStateAnswer } from "./display-state";

const PLAN: DisplayState = {
  subscriptionStatus: "ACTIVE",
  tier: { code: "free", name: "Free" },
  quotaRemaining: 2,
  resetAt: "2026-09-14T08:31:22.101Z",
  features: {},
};

interface Call {
  url: string;
  headers: Record<string, string>;
}

function api(options: {
  token?: AccessToken;
  answer?: () => Response | Promise<Response>;
} = {}) {
  const calls: Call[] = [];
  const client = new MprelistApi({
    tokens: { accessToken: async () => options.token ?? { status: "ready", token: "an-access-token" } },
    http: async (url, init) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return (options.answer ?? (() => json(PLAN)))();
    },
  });
  return { client, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("asking the backend what the caller is shown", () => {
  it("sends the token it was given, to the route the contract names", async () => {
    const { client, calls } = api();

    await expect(client.displayState()).resolves.toEqual({ status: "ready", plan: PLAN });
    expect(calls[0]?.url).toBe("http://localhost:8080/api/me");
    expect(calls[0]?.headers["authorization"]).toBe("Bearer an-access-token");
  });

  it("asks nothing at all when there is no session", async () => {
    const { client, calls } = api({ token: { status: "signed-out" } });

    await expect(client.displayState()).resolves.toEqual({ status: "signed-out" });
    expect(calls).toHaveLength(0);
  });

  it("passes on a token that could not be renewed as unavailable, not as signed out", async () => {
    // The session is still there; Keycloak was not. The screen for that is "try
    // again", not a sign-in button (T24, #33).
    const { client } = api({ token: { status: "unavailable" } });

    await expect(client.displayState()).resolves.toEqual({ status: "unavailable" });
  });
});

describe("fail-closed, which applies to display too", () => {
  const nothingIsShown: Array<[string, () => Response]> = [
    ["a 500", () => json({}, 500)],
    ["a 502 serving HTML", () => new Response("<html>bad gateway</html>", { status: 502 })],
    ["a 200 that is not JSON", () => new Response("not json", { status: 200 })],
    ["a 200 with nothing in it", () => json(null)],
    ["a plan with no tier", () => json({ ...PLAN, tier: undefined })],
    ["a plan whose tier has no code", () => json({ ...PLAN, tier: { name: "Free" } })],
    ["a status this build has never heard of", () => json({ ...PLAN, subscriptionStatus: "PAUSED" })],
    ["a quota that is not a number", () => json({ ...PLAN, quotaRemaining: "2" })],
    ["a negative quota", () => json({ ...PLAN, quotaRemaining: -1 })],
    ["no reset date", () => json({ ...PLAN, resetAt: undefined })],
    ["features that are not an object", () => json({ ...PLAN, features: [] })],
  ];

  it.each(nothingIsShown)("renders unavailable rather than a plan for %s", async (_name, answer) => {
    // Never "active" from an answer nobody could read: a plan with holes in it is
    // a live Repost button in front of a user the gate is about to refuse.
    const { client } = api({ answer });

    await expect(client.displayState()).resolves.toEqual({ status: "unavailable" });
  });

  it("renders unavailable when the backend cannot be reached at all", async () => {
    const { client } = api({
      answer: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await expect(client.displayState()).resolves.toEqual({ status: "unavailable" });
  });

  it("says signed out when the API refuses the token", async () => {
    // The one refusal this route has. A token we just refreshed and the API will
    // not take is a session only a fresh sign-in can fix, so "unavailable" would
    // offer a retry button that cannot work.
    const { client } = api({ answer: () => json({ reason: "UNAUTHENTICATED" }, 401) });

    await expect(client.displayState()).resolves.toEqual({ status: "signed-out" });
  });
});

describe("the body", () => {
  it("is read whole, and keeps what the tier is called as well as its code", () => {
    // Both spellings travel because branding a plan by a name an operator may
    // rewrite is how a client stops matching the day they rewrite it.
    expect(asDisplayState({ ...PLAN, tier: { code: "pro", name: "Pro" } })?.tier).toEqual({
      code: "pro",
      name: "Pro",
    });
  });

  it("keeps a lapsed status rather than flattening it to something friendlier", () => {
    const lapsed: DisplayStateAnswer["status"] = "ready";
    expect(lapsed).toBe("ready");
    expect(asDisplayState({ ...PLAN, subscriptionStatus: "PAST_DUE" })?.subscriptionStatus).toBe("PAST_DUE");
  });

  it("keeps the flags the tier carries, empty or not", () => {
    expect(asDisplayState({ ...PLAN, features: { bulk: true } })?.features).toEqual({ bulk: true });
    expect(asDisplayState(PLAN)?.features).toEqual({});
  });
});
