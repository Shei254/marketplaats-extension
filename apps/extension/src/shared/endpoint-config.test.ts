/**
 * Guards the single endpoint-config definition (T02).
 *
 * The bug this file exists to prevent: the config carried a `getBucket` key
 * while `EndpointName` said `getBuckets`, so that endpoint could never be
 * reached from a stored config — and nothing failed, because the two lived in
 * separate copies that drifted. `DEFAULT_ENDPOINT_CONFIG` is now total over
 * `EndpointName`, which makes that a compile error; these tests cover the
 * runtime half, that every name a caller may ask for actually resolves and can
 * be overridden from storage.
 *
 * Paths themselves are frozen by the golden tests, not here.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub";
import {
  DEFAULT_ENDPOINT_CONFIG,
  isEndpointConfigChange,
  loadEndpointConfig,
  saveEndpointOverrides,
  type EndpointConfig,
  type EndpointName,
} from "./endpoint-config";

const STORAGE_KEY = "endpointOverrides";
/** What the POC Options page and the pre-override `__setEndpoints` wrote. */
const LEGACY_STORAGE_KEY = "endpointConfig";

/** Every configurable operation, read off the defaults so the list cannot drift. */
const ENDPOINT_NAMES = Object.keys(DEFAULT_ENDPOINT_CONFIG).filter(
  (key) => key !== "csrf",
) as EndpointName[];

let chromeStub: ChromeStub;
let area: Record<string, unknown>;

beforeEach(() => {
  chromeStub = installChromeStub();
  area = chromeStub.area;
});

afterEach(() => {
  chromeStub.restore();
});

describe("loadEndpointConfig", () => {
  it("falls back to the discovered defaults when nothing is stored", async () => {
    await expect(loadEndpointConfig()).resolves.toEqual(DEFAULT_ENDPOINT_CONFIG);
  });

  it("resolves a non-empty path for every endpoint name", async () => {
    const config = await loadEndpointConfig();

    expect(ENDPOINT_NAMES.length).toBeGreaterThan(0);
    for (const name of ENDPOINT_NAMES) {
      expect(config[name], `endpoint '${name}' has no default path`).toBeTruthy();
    }
  });

  // The drift bug, stated as a test: a tester pastes a path for one operation
  // and it has to be the path that operation then calls.
  it.each(ENDPOINT_NAMES)("lets a stored config override '%s'", async (name) => {
    area[STORAGE_KEY] = { [name]: `/overridden/${name}` } satisfies Partial<EndpointConfig>;

    const config = await loadEndpointConfig();

    expect(config[name]).toBe(`/overridden/${name}`);
  });

  it("leaves the endpoints a stored config omits at their defaults", async () => {
    area[STORAGE_KEY] = { listMyAds: "/custom/listings" };

    const config = await loadEndpointConfig();

    expect(config.listMyAds).toBe("/custom/listings");
    expect(config.createAd).toBe(DEFAULT_ENDPOINT_CONFIG.createAd);
    expect(config.getBucketCategories).toBe(DEFAULT_ENDPOINT_CONFIG.getBucketCategories);
  });

  it("replaces the CSRF config wholesale rather than merging variants", async () => {
    area[STORAGE_KEY] = { csrf: { mode: "none", header: "x-none" } };

    const { csrf } = await loadEndpointConfig();

    expect(csrf).toEqual({ mode: "none", header: "x-none" });
    // A shallow merge would have left the "fetch" variant's url/extractor behind
    // on a config whose mode says they do not exist.
    expect(csrf).not.toHaveProperty("url");
    expect(csrf).not.toHaveProperty("extractor");
  });
});

describe("saveEndpointOverrides", () => {
  it("round-trips through storage", async () => {
    await saveEndpointOverrides({ deleteAd: "/custom/delete" });

    const config = await loadEndpointConfig();

    expect(config.deleteAd).toBe("/custom/delete");
  });

  // The bug this function replaced: __setEndpoints wrote the *resolved* config
  // back, so overriding any one endpoint pinned all nine at the running build's
  // defaults. Asserting on what reaches storage, not on what loads back out —
  // a resolved write and an override write are indistinguishable through
  // loadEndpointConfig until the defaults change, which is exactly when the old
  // behaviour bit.
  it("stores only the overridden keys, never the resolved config", async () => {
    await saveEndpointOverrides({ deleteAd: "/custom/delete" });

    expect(area[STORAGE_KEY]).toEqual({ deleteAd: "/custom/delete" });
  });

  it("leaves an untouched endpoint free to follow a later build's default", async () => {
    await saveEndpointOverrides({ deleteAd: "/custom/delete" });

    // Nothing is stored for createAd, so it resolves from whatever the build
    // ships. That is what lets a corrected default reach an existing profile
    // instead of being shadowed by a value frozen at first override.
    expect(area[STORAGE_KEY]).not.toHaveProperty("createAd");
    await expect(loadEndpointConfig()).resolves.toHaveProperty(
      "createAd",
      DEFAULT_ENDPOINT_CONFIG.createAd,
    );
  });

  it("merges successive overrides rather than replacing them", async () => {
    await saveEndpointOverrides({ deleteAd: "/custom/delete" });
    await saveEndpointOverrides({ listMyAds: "/custom/listings" });

    expect(area[STORAGE_KEY]).toEqual({
      deleteAd: "/custom/delete",
      listMyAds: "/custom/listings",
    });
  });

  it("replaces a stored csrf block wholesale rather than merging variants", async () => {
    await saveEndpointOverrides({ csrf: { mode: "meta", name: "t", header: "x-t" } });
    await saveEndpointOverrides({ csrf: { mode: "none", header: "x-none" } });

    expect((area[STORAGE_KEY] as Partial<EndpointConfig>).csrf).toEqual({
      mode: "none",
      header: "x-none",
    });
  });

  it("returns the overrides now in effect", async () => {
    await saveEndpointOverrides({ deleteAd: "/custom/delete" });

    await expect(saveEndpointOverrides({ listMyAds: "/custom/listings" })).resolves.toEqual({
      deleteAd: "/custom/delete",
      listMyAds: "/custom/listings",
    });
  });

  // The content script drops its cached config on this signal, so the key the
  // watcher matches has to be the key the writer writes.
  it("writes the key isEndpointConfigChange watches", async () => {
    await saveEndpointOverrides({ deleteAd: "/custom/delete" });

    const changes = Object.fromEntries(
      Object.keys(area).map((key) => [key, { newValue: area[key] }]),
    );
    expect(isEndpointConfigChange(changes, "local")).toBe(true);
  });
});

// The stale-profile half of the same bug, and it spans both functions — one test
// only reads — so it is its own block rather than misfiled under the writer.
//
// A tester who used the Options page, or __setEndpoints before it stored
// overrides, has a *resolved* config under the old key: nine endpoints pinned at
// the defaults of whatever build wrote it. Read as overrides it would shadow
// every later default — indistinguishable from the bug that was just fixed, and
// permanent, since nothing would ever overwrite a key the tester does not know
// to clear.
describe("the pre-override storage key", () => {
  it("is never read, so a stale resolved config cannot shadow a later default", async () => {
    area[LEGACY_STORAGE_KEY] = { ...DEFAULT_ENDPOINT_CONFIG, deleteAd: "/stale/delete" };

    await expect(loadEndpointConfig()).resolves.toEqual(DEFAULT_ENDPOINT_CONFIG);
  });

  it("is dropped once overrides are written", async () => {
    area[LEGACY_STORAGE_KEY] = { ...DEFAULT_ENDPOINT_CONFIG };

    await saveEndpointOverrides({ deleteAd: "/custom/delete" });

    expect(area).not.toHaveProperty(LEGACY_STORAGE_KEY);
    expect(area[STORAGE_KEY]).toEqual({ deleteAd: "/custom/delete" });
  });
});

describe("isEndpointConfigChange", () => {
  it("ignores other keys and other storage areas", () => {
    const change = { [STORAGE_KEY]: { newValue: DEFAULT_ENDPOINT_CONFIG } };

    expect(isEndpointConfigChange(change, "sync")).toBe(false);
    expect(isEndpointConfigChange({ somethingElse: { newValue: 1 } }, "local")).toBe(false);
  });
});
