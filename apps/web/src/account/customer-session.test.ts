import { describe, expect, it } from "vitest";

import { DEFAULT_ADMIN_CONFIG } from "../admin/admin-config";
import type { Http } from "../admin/discovery";
import { discoveryDocument, inMemoryStorage, json, tokenFor } from "../admin/testing";
import {
  CHOICE,
  IN_FLIGHT,
  SIGNED_IN,
  customerArriving,
  signIn,
  start,
  type SessionDeps,
} from "./customer-session";

/**
 * The customer session on `/` (T85, ADR-0036): who is signed in, what survives a
 * reload, and how `/` tells a returning buyer from a returning operator.
 */

function world(local: Record<string, string> = {}) {
  const calls: string[] = [];
  const sentTo: string[] = [];
  const replaced: string[] = [];
  const http: Http = async (url) => {
    calls.push(url);
    if (url.includes("/.well-known/")) return json(discoveryDocument(DEFAULT_ADMIN_CONFIG.issuer));
    return json({ access_token: tokenFor([]) });
  };
  const deps: SessionDeps = {
    config: DEFAULT_ADMIN_CONFIG,
    http,
    session: inMemoryStorage(),
    local: inMemoryStorage(local),
    navigate: (url) => void sentTo.push(url),
    replaceUrl: (url) => void replaced.push(url),
  };
  return { deps, calls, sentTo, replaced };
}

/** Starts a sign-in and answers it the way Keycloak would, with `answer` built from its state. */
async function signedInAndBack(deps: SessionDeps, sentTo: string[], answer: (state: string) => string) {
  const state = new URL(sentTo.at(-1) ?? "").searchParams.get("state") ?? "";
  return start(deps, answer(state));
}

describe("a visitor arriving on /", () => {
  it("is drawn signed out, and sent nowhere, when nobody has signed in here", async () => {
    const { deps, calls, sentTo } = world();

    expect(await start(deps, "")).toEqual({ kind: "signed-out", notice: null });
    expect(sentTo).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("is signed back in silently when somebody has — the flag, and no page shown", async () => {
    const { deps, sentTo } = world({ [SIGNED_IN]: "1" });

    expect(await start(deps, "")).toEqual({ kind: "redirecting" });
    const authorize = new URL(sentTo[0] ?? "");
    expect(authorize.searchParams.get("prompt")).toBe("none");
    expect(authorize.searchParams.get("client_id")).toBe("mprelist-dashboard");
  });

  it("keeps no token anywhere, only the flag", async () => {
    const { deps, sentTo } = world();
    await signIn(deps);

    const arrived = await signedInAndBack(deps, sentTo, (state) => `?code=c&state=${state}`);

    expect(arrived.kind).toBe("arrived");
    expect(deps.local.getItem(SIGNED_IN)).toBe("1");
    expect(deps.local.length).toBe(1);
    expect(deps.session.getItem(IN_FLIGHT)).toBeNull();
  });

  it("takes the ?code= off the address, so a reload does not try it twice", async () => {
    const { deps, sentTo, replaced } = world();
    await signIn(deps);

    await signedInAndBack(deps, sentTo, (state) => `?code=c&state=${state}`);

    expect(replaced).toEqual(["/"]);
  });

  it("carries the card they pressed through the sign-in, and only once", async () => {
    const { deps, sentTo } = world();
    await signIn(deps, { tierCode: "pro", interval: "year" });

    const arrived = await signedInAndBack(deps, sentTo, (state) => `?code=c&state=${state}`);

    expect(arrived).toMatchObject({ kind: "arrived", choice: { tierCode: "pro", interval: "year" } });
    expect(deps.session.getItem(CHOICE)).toBeNull();
  });

  it("forgets the flag when Keycloak's session has ended, and draws the page signed out", async () => {
    const { deps, sentTo } = world({ [SIGNED_IN]: "1" });
    await start(deps, "");

    const answered = await signedInAndBack(deps, sentTo, (state) => `?error=login_required&state=${state}`);

    expect(answered).toEqual({ kind: "signed-out", notice: null });
    expect(deps.local.getItem(SIGNED_IN)).toBeNull();
  });

  it("but asks them to sign in when that silent attempt carried a card they pressed", async () => {
    const { deps, sentTo } = world({ [SIGNED_IN]: "1" });
    await signIn(deps, { tierCode: "pro", interval: "month" }, true);

    const answered = await signedInAndBack(deps, sentTo, (state) => `?error=login_required&state=${state}`);

    expect(answered).toEqual({ kind: "redirecting" });
    expect(new URL(sentTo.at(-1) ?? "").searchParams.get("prompt")).toBeNull();
    expect(deps.session.getItem(CHOICE)).toContain('"pro"');
  });

  it("says so when a sign-in fails for any other reason", async () => {
    const { deps, sentTo } = world();
    await signIn(deps);

    const answered = await signedInAndBack(deps, sentTo, () => "?code=c&state=somebody-elses");

    expect(answered).toMatchObject({ kind: "signed-out", notice: expect.stringContaining("niet gelukt") });
  });
});

describe("telling a buyer from an operator on /", () => {
  it("is the in-flight record each one kept", () => {
    const buyer = inMemoryStorage({ [IN_FLIGHT]: "{}" });
    const operator = inMemoryStorage({ "mprelist.admin.sign-in": "{}" });

    expect(customerArriving("?code=c&state=s", buyer)).toBe(true);
    expect(customerArriving("?code=c&state=s", operator)).toBe(false);
    expect(customerArriving("", buyer)).toBe(false);
  });
});
