/**
 * The worker's half of the served configuration (T27, #36; ADR-0013).
 *
 * **The behaviour worth pinning is what happens when the ask goes wrong**, and
 * the two ways it can go wrong are opposite. A backend that could not be reached
 * must leave a stored document alone — it may be the hotfix that is currently
 * holding relisting together, and un-applying it because of an API blip would
 * make this feature a liability rather than a lever. A `200` this build cannot
 * read is an operator who has deployed *something*: what was stored is
 * superseded, so it goes and the build's own defaults stand.
 *
 * The throttle is here rather than at the call site because a worker has no
 * memory between wakes. Its tests are therefore about storage, not about a
 * counter.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installChromeStub, type ChromeStub } from "../testing/chrome-stub";
import type { AccessToken } from "../auth/session";
import {
  readServedConfig,
  writeServedConfig,
  SUPPORTED_SCHEMA_VERSION,
  type ServedConfig,
} from "../shared/served-config";
import { ClientConfigFetcher } from "./client-config";

const NOW = 1_700_000_000_000;
const FIFTEEN_MINUTES = 15 * 60_000;

const DOCUMENT = {
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  endpoints: { deleteAd: "/seller/api/delete-ad-v2" },
};

const CHECKED: ServedConfig = {
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  endpoints: { deleteAd: "/seller/api/delete-ad-v2" },
  csrf: null,
  pacing: null,
  bulkPacing: null,
  rails: null,
};

interface Call {
  url: string;
  headers: Record<string, string>;
}

function fetcher(
  options: { token?: AccessToken; answer?: () => Response; now?: () => number } = {},
) {
  const calls: Call[] = [];
  const client = new ClientConfigFetcher({
    tokens: {
      accessToken: async () => options.token ?? { status: "ready", token: "an-access-token" },
    },
    http: async (url, init) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return (options.answer ?? (() => json(DOCUMENT)))();
    },
    clock: options.now ?? (() => NOW),
  });
  return { client, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const empty = (status: number): Response => new Response(null, { status });

let chromeStub: ChromeStub;

beforeEach(() => {
  chromeStub = installChromeStub();
});

afterEach(() => {
  chromeStub.restore();
});

describe("asking for the document", () => {
  it("sends the token and this build's name to the route the contract names", async () => {
    const { client, calls } = fetcher();

    await expect(client.refresh()).resolves.toEqual({ status: "stored", config: CHECKED });
    expect(calls[0]?.url).toBe("http://localhost:8080/api/client-config");
    expect(calls[0]?.headers["authorization"]).toBe("Bearer an-access-token");
    expect(calls[0]?.headers["X-Mprelist-Client"]).toBe("extension/9.9.9");
  });

  it("stores what it was served, stamped with when", async () => {
    const { client } = fetcher();

    await client.refresh();

    await expect(readServedConfig()).resolves.toEqual({ fetchedAt: NOW, config: CHECKED });
  });

  // `{"schemaVersion":1}` is the healthy deployment's answer and it means "your
  // defaults are correct" — which is also how an operator takes a hotfix back off.
  it("stores the empty patch, which is how an override is withdrawn", async () => {
    const { client } = fetcher({ answer: () => json({ schemaVersion: SUPPORTED_SCHEMA_VERSION }) });
    await writeServedConfig({ fetchedAt: NOW - FIFTEEN_MINUTES, config: CHECKED });

    await client.refresh();

    await expect(readServedConfig()).resolves.toEqual({
      fetchedAt: NOW,
      config: {
        schemaVersion: SUPPORTED_SCHEMA_VERSION,
        endpoints: {},
        csrf: null,
        pacing: null,
        bulkPacing: null,
        rails: null,
      },
    });
  });
});

describe("when the ask does not produce a document", () => {
  // The half that matters most: a document already stored may be the fix that is
  // keeping relisting alive, and nothing that failed to arrive is evidence
  // against it.
  it.each([
    ["a backend that could not be reached", () => empty(503)],
    ["a token this API will not take", () => empty(401)],
    ["a build this API no longer serves", () => empty(426)],
    ["an answer that is not JSON", () => new Response("<html>", { status: 200 })],
  ])("leaves what was stored alone for %s", async (_name, answer) => {
    await writeServedConfig({ fetchedAt: NOW - FIFTEEN_MINUTES, config: CHECKED });
    const { client } = fetcher({ answer });

    await client.refresh();

    await expect(readServedConfig()).resolves.toEqual({
      fetchedAt: NOW - FIFTEEN_MINUTES,
      config: CHECKED,
    });
  });

  it("says which failure it was, since the fixes are different", async () => {
    await expect(fetcher({ answer: () => empty(503) }).client.refresh()).resolves.toEqual({
      status: "unavailable",
    });
    await expect(fetcher({ answer: () => empty(401) }).client.refresh()).resolves.toEqual({
      status: "signed-out",
    });
    await expect(fetcher({ answer: () => empty(426) }).client.refresh()).resolves.toEqual({
      status: "outdated",
    });
    // A `200` carrying HTML is not our API answering at all, so it is the same
    // answer as not reaching it — never "an operator deployed something odd".
    await expect(
      fetcher({ answer: () => new Response("<html>", { status: 200 }) }).client.refresh(),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("reads a network error as unavailable rather than throwing it at a worker's startup", async () => {
    const client = new ClientConfigFetcher({
      tokens: { accessToken: async () => ({ status: "ready", token: "t" }) },
      http: async () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await expect(client.refresh()).resolves.toEqual({ status: "unavailable" });
  });

  // Everything this document configures happens on behalf of somebody signed in,
  // so a worker waking for a signed-out user has nothing to ask with — and the
  // document it holds is still the right one for the moment they sign in.
  it("does not ask, and does not forget, when nobody is signed in", async () => {
    await writeServedConfig({ fetchedAt: 1, config: CHECKED });
    const { client, calls } = fetcher({ token: { status: "signed-out" } });

    await expect(client.refresh()).resolves.toEqual({ status: "signed-out" });
    expect(calls).toEqual([]);
    await expect(readServedConfig()).resolves.toEqual({ fetchedAt: 1, config: CHECKED });
  });
});

// The opposite of the block above, and the reason the two are not one: this is a
// `200`. An operator has deployed something this release cannot read, so the last
// thing it *could* read is yesterday's fix for a breakage that has moved on.
describe("when the document is one this build cannot read", () => {
  it.each([
    ["a shape from a newer API", { schemaVersion: SUPPORTED_SCHEMA_VERSION + 1, endpoints: {} }],
    ["a mode no branch here answers to", { ...DOCUMENT, csrf: { mode: "eval", header: "x" } }],
    ["a path that is empty", { ...DOCUMENT, endpoints: { deleteAd: "" } }],
  ])("forgets what was stored and falls back to the build's defaults: %s", async (_name, body) => {
    await writeServedConfig({ fetchedAt: NOW - FIFTEEN_MINUTES, config: CHECKED });
    const { client } = fetcher({ answer: () => json(body) });

    await expect(client.refresh()).resolves.toEqual({ status: "unreadable" });
    await expect(readServedConfig()).resolves.toBeNull();
  });
});

describe("the fifteen-minute throttle", () => {
  it("does not ask again for a document fetched a minute ago", async () => {
    await writeServedConfig({ fetchedAt: NOW - 60_000, config: CHECKED });
    const { client, calls } = fetcher();

    await expect(client.refreshIfStale()).resolves.toEqual({ status: "fresh", config: CHECKED });
    expect(calls).toEqual([]);
  });

  it("asks once the window has passed", async () => {
    await writeServedConfig({ fetchedAt: NOW - FIFTEEN_MINUTES, config: CHECKED });
    const { client, calls } = fetcher();

    await expect(client.refreshIfStale()).resolves.toEqual({ status: "stored", config: CHECKED });
    expect(calls).toHaveLength(1);
  });

  it("asks when nothing has ever been fetched", async () => {
    const { client, calls } = fetcher();

    await client.refreshIfStale();

    expect(calls).toHaveLength(1);
  });

  // The clock is the user's machine's and it can jump. A stamp in the future read
  // as fresh would pin this client to one document until the calendar caught up
  // — which for a machine set a year forward is the whole point of ADR-0013 lost.
  it("treats a stamp from the future as stale rather than as fresh forever", async () => {
    await writeServedConfig({ fetchedAt: NOW + 60_000, config: CHECKED });
    const { client, calls } = fetcher();

    await client.refreshIfStale();

    expect(calls).toHaveLength(1);
  });

  // The throttle is not a rule about *this* fetcher; it is a rule about the
  // deployment. A worker that has just woken is a new object and must inherit the
  // last wake's answer, which is why the question is asked of storage.
  it("is a fact about storage rather than about one fetcher's lifetime", async () => {
    await fetcher().client.refreshIfStale();

    const { calls } = fetcher();
    await fetcher().client.refreshIfStale();

    expect(calls).toEqual([]);
  });

  // `__clientConfig` exists so a tester who has just deployed a document can see
  // it, rather than waiting out a window whose purpose is to keep ordinary wakes
  // cheap.
  it("is not applied when the document is asked for outright", async () => {
    await writeServedConfig({ fetchedAt: NOW, config: CHECKED });
    const { client, calls } = fetcher();

    await client.refresh();

    expect(calls).toHaveLength(1);
  });
});
