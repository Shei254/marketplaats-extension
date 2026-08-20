import { afterEach, describe, expect, it } from "vitest";

import { installChromeStub, type ChromeStub } from "../testing/chrome-stub";
import type { AuthSession } from "../auth/session";
import { ChromeSessionStore, asSession } from "./chrome-session-store";

const session: AuthSession = {
  accessToken: "an-access-token",
  refreshToken: "a-refresh-token",
  idToken: "an-id-token",
  expiresAt: 1_755_000_300_000,
  obtainedAt: 1_755_000_000_000,
};

let stub: ChromeStub | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("the session in chrome.storage.local", () => {
  it("round-trips, and clears", async () => {
    stub = installChromeStub();
    const store = new ChromeSessionStore();

    await store.write(session);
    await expect(store.read()).resolves.toEqual(session);

    await store.clear();
    await expect(store.read()).resolves.toBeNull();
    // Removed rather than written as null: nothing else reads this key, and a
    // tombstone is a thing to keep interpreting.
    expect(stub.area).not.toHaveProperty("authSession");
  });

  it("is signed out when nothing was ever stored", async () => {
    stub = installChromeStub();
    await expect(new ChromeSessionStore().read()).resolves.toBeNull();
  });

  it("is signed out rather than half signed in when the stored value is junk", async () => {
    // Storage outlives the code that wrote it. The alternative to this check is a
    // bearer header reading `undefined` and a 401 nobody can explain.
    for (const junk of [
      undefined,
      null,
      "a string",
      {},
      { accessToken: "", expiresAt: 1, obtainedAt: 1 },
      { accessToken: "t", expiresAt: "soon", obtainedAt: 1 },
      { accessToken: "t", expiresAt: 1 },
    ]) {
      expect(asSession(junk), JSON.stringify(junk) ?? "undefined").toBeNull();
    }
  });

  it("survives a session stored without the optional halves", async () => {
    stub = installChromeStub({
      authSession: { accessToken: "t", expiresAt: 2, obtainedAt: 1 },
    });

    await expect(new ChromeSessionStore().read()).resolves.toEqual({
      accessToken: "t",
      refreshToken: null,
      idToken: null,
      expiresAt: 2,
      obtainedAt: 1,
    });
  });
});
