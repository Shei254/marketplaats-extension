/**
 * The checker that stands between the wire and everything that calls Marktplaats
 * (T27, #36; ADR-0013).
 *
 * **What is being tested is a refusal, mostly.** The ADR's hard constraint is
 * that a served document is data — so the interesting assertions here are not
 * that a good document is read, but that every shape which is *nearly* one is
 * dropped whole. A checker that let half a document through would be a config
 * that is partly applied, which is the state an operator cannot reason about:
 * they would be looking at a deploy that worked and a client doing some of it.
 *
 * Storage is checked on the way out as well as on the way in, because
 * `chrome.storage.local` is the user's under ADR-0007 and outlives the build that
 * wrote it — the same assumption `ChromePaceStore` already makes about a deadline.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installChromeStub, type ChromeStub } from "../testing/chrome-stub";
import {
  asServedConfig,
  forgetServedConfig,
  isServedConfigChange,
  readServedConfig,
  writeServedConfig,
  SUPPORTED_SCHEMA_VERSION,
  type ServedConfig,
} from "./served-config";

const STORAGE_KEY = "clientConfig";

/** The whole document, in the shape the API actually serves it. */
const EVERYTHING = {
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  endpoints: { deleteAd: "/seller/api/delete-ad-v2" },
  csrf: { mode: "meta", header: "x-mp-xsrf", name: "csrf-token" },
  pacing: { minMs: 60_000, maxMs: 120_000 },
};

const EMPTY: ServedConfig = {
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  endpoints: {},
  csrf: null,
  pacing: null,
};

let chromeStub: ChromeStub;

beforeEach(() => {
  chromeStub = installChromeStub();
});

afterEach(() => {
  chromeStub.restore();
});

describe("reading a served document", () => {
  it("keeps every field an operator overrode", () => {
    expect(asServedConfig(EVERYTHING)).toEqual({
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      endpoints: { deleteAd: "/seller/api/delete-ad-v2" },
      csrf: { mode: "meta", header: "x-mp-xsrf", name: "csrf-token" },
      pacing: { minMs: 60_000, maxMs: 120_000 },
    });
  });

  // `{"schemaVersion":1}` is what a healthy deployment serves and it means "your
  // defaults are correct". Reading it as unreadable would make the ordinary case
  // the failing one.
  it("reads the empty patch as an answer rather than as a failure", () => {
    expect(asServedConfig({ schemaVersion: SUPPORTED_SCHEMA_VERSION })).toEqual(EMPTY);
  });

  it("ignores a document announcing a shape this build does not know", () => {
    // The whole point of a version: half of a document written for a newer
    // client is the failure the number exists to prevent, so the answer is the
    // built-in defaults rather than the parts that happen to look familiar.
    expect(asServedConfig({ ...EVERYTHING, schemaVersion: SUPPORTED_SCHEMA_VERSION + 1 })).toBeNull();
    expect(asServedConfig({ ...EVERYTHING, schemaVersion: "1" })).toBeNull();
    expect(asServedConfig({ endpoints: {} })).toBeNull();
  });

  it.each([undefined, null, 7, "a document", [], [EVERYTHING]])(
    "ignores %p, which is not a document at all",
    (body) => {
      expect(asServedConfig(body)).toBeNull();
    },
  );
});

describe("the endpoint paths", () => {
  // Every value here ends up in a URL, which is the one thing this document does
  // that reaches the network. An empty string would become a request to the
  // site's root — a delete aimed at nothing, or worse at something.
  it("refuses a path that is empty or is not a string", () => {
    expect(asServedConfig({ ...EVERYTHING, endpoints: { deleteAd: "" } })).toBeNull();
    expect(asServedConfig({ ...EVERYTHING, endpoints: { deleteAd: 7 } })).toBeNull();
    expect(asServedConfig({ ...EVERYTHING, endpoints: ["/a/path"] })).toBeNull();
  });

  // One bad path discards the document rather than being skipped, for the reason
  // the module's docstring gives: a partly applied config is worse than none.
  it("discards the whole document for one bad path", () => {
    expect(
      asServedConfig({
        ...EVERYTHING,
        endpoints: { deleteAd: "/seller/api/delete-ad-v2", createAd: "" },
      }),
    ).toBeNull();
  });

  // A name from a newer build is not this checker's business — dropping it is
  // the merge's job, where the names live. Refusing it here would make one
  // document unservable to every installed release at once.
  it("keeps a name this build has never heard of, for the merge to drop", () => {
    const config = asServedConfig({ ...EVERYTHING, endpoints: { somethingNewer: "/x" } });

    expect(config?.endpoints).toEqual({ somethingNewer: "/x" });
  });
});

describe("the CSRF block", () => {
  it("takes each mode with the fields that mode carries", () => {
    expect(asServedConfig({ ...EVERYTHING, csrf: { mode: "none", header: "x-h" } })?.csrf).toEqual({
      mode: "none",
      header: "x-h",
    });
    expect(
      asServedConfig({ ...EVERYTHING, csrf: { mode: "cookie", header: "x-h", name: "c" } })?.csrf,
    ).toEqual({ mode: "cookie", header: "x-h", name: "c" });
    expect(
      asServedConfig({
        ...EVERYTHING,
        csrf: {
          mode: "fetch",
          header: "x-h",
          url: "https://www.marktplaats.nl/",
          extractor: { selector: "meta[name=csrf]", attribute: "content" },
        },
      })?.csrf,
    ).toEqual({
      mode: "fetch",
      header: "x-h",
      url: "https://www.marktplaats.nl/",
      extractor: { type: "dom", selector: "meta[name=csrf]", attribute: "content" },
    });
  });

  // The line between data and code, drawn where it can be seen: there is no
  // branch a document can name that this build was not shipped with, so nothing
  // served is ever compiled or evaluated — only compared.
  it("refuses a mode no branch in this build answers to", () => {
    expect(asServedConfig({ ...EVERYTHING, csrf: { mode: "eval", header: "x-h" } })).toBeNull();
    expect(asServedConfig({ ...EVERYTHING, csrf: { mode: "META", header: "x-h" } })).toBeNull();
  });

  // The local `CsrfConfig` has a regex variant that nothing has ever constructed.
  // This checker cannot produce one, so a served document cannot reach it.
  it("cannot produce the regex extractor the local type still allows", () => {
    const served = asServedConfig({
      ...EVERYTHING,
      csrf: {
        mode: "fetch",
        header: "x-h",
        url: "https://www.marktplaats.nl/",
        extractor: { type: "regex", pattern: "csrf=([a-z]+)" },
      },
    });

    expect(served).toBeNull();
  });

  it("refuses a mode whose own fields are missing", () => {
    expect(asServedConfig({ ...EVERYTHING, csrf: { mode: "meta", header: "x-h" } })).toBeNull();
    expect(asServedConfig({ ...EVERYTHING, csrf: { mode: "fetch", header: "x-h" } })).toBeNull();
    expect(asServedConfig({ ...EVERYTHING, csrf: { mode: "none" } })).toBeNull();
  });
});

describe("the pacing window", () => {
  it("refuses a window that does not run forwards from zero", () => {
    expect(asServedConfig({ ...EVERYTHING, pacing: { minMs: -1, maxMs: 10 } })).toBeNull();
    expect(asServedConfig({ ...EVERYTHING, pacing: { minMs: 90_000, maxMs: 1_000 } })).toBeNull();
    expect(asServedConfig({ ...EVERYTHING, pacing: { minMs: "60000", maxMs: 90_000 } })).toBeNull();
  });

  // The wait happens *in the worker*, and an MV3 worker is killed a few minutes
  // after it goes idle. A window past that is a relist that never starts, with
  // the user watching a countdown while it does not.
  it("refuses a gap longer than the worker that has to wait it out", () => {
    expect(asServedConfig({ ...EVERYTHING, pacing: { minMs: 0, maxMs: 5 * 60_000 } })).not.toBeNull();
    expect(asServedConfig({ ...EVERYTHING, pacing: { minMs: 0, maxMs: 5 * 60_000 + 1 } })).toBeNull();
  });

  // A floor under the backend's own rail costs the user a cooldown they would
  // have been refused anyway. Coupling this client to a number that lives in the
  // API's configuration would be two settings that have to deploy in step.
  it("does not hold the window to the backend's own rail", () => {
    expect(asServedConfig({ ...EVERYTHING, pacing: { minMs: 0, maxMs: 1 } })).not.toBeNull();
  });
});

describe("what storage hands back", () => {
  it("round-trips a document that was checked before it was written", async () => {
    await writeServedConfig({ fetchedAt: 1_700_000_000_000, config: asServedConfig(EVERYTHING)! });

    await expect(readServedConfig()).resolves.toEqual({
      fetchedAt: 1_700_000_000_000,
      config: asServedConfig(EVERYTHING),
    });
  });

  it("is nothing at all before anything has been fetched", async () => {
    await expect(readServedConfig()).resolves.toBeNull();
  });

  // Storage is the user's under ADR-0007 and outlives the build that wrote it, so
  // a document that was legal when it was written may not be one now — a version
  // this build has stopped serving, or a value somebody typed in by hand.
  it.each([
    ["a document from a build that read another shape", { fetchedAt: 1, config: { schemaVersion: 99 } }],
    ["a document somebody edited", { fetchedAt: 1, config: { ...EVERYTHING, endpoints: { deleteAd: "" } } }],
    ["a stamp that is not a time", { fetchedAt: "yesterday", config: EVERYTHING }],
    ["no stamp at all", { config: EVERYTHING }],
    ["something that is not a record", "clientConfig"],
  ])("reads %s as nothing, so the build's own defaults stand", async (_name, held) => {
    chromeStub.area[STORAGE_KEY] = held;

    await expect(readServedConfig()).resolves.toBeNull();
  });

  it("is forgotten on request, which is the fallback to what this build shipped with", async () => {
    await writeServedConfig({ fetchedAt: 1, config: asServedConfig(EVERYTHING)! });

    await forgetServedConfig();

    expect(chromeStub.area).not.toHaveProperty(STORAGE_KEY);
    await expect(readServedConfig()).resolves.toBeNull();
  });
});

// The content script caches its resolved config for its own lifetime and drops it
// on this signal, so the key the watcher matches has to be the key the writer
// writes — the same pairing `endpoint-config.test.ts` already holds.
describe("noticing that the document changed", () => {
  it("matches the key the writer writes, and nothing else", async () => {
    await writeServedConfig({ fetchedAt: 1, config: EMPTY });

    expect(isServedConfigChange({ [STORAGE_KEY]: { newValue: chromeStub.area[STORAGE_KEY] } })).toBe(
      true,
    );
    expect(isServedConfigChange({ endpointOverrides: { newValue: {} } })).toBe(false);
  });
});
