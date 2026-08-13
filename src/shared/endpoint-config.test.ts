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
import {
  DEFAULT_ENDPOINT_CONFIG,
  isEndpointConfigChange,
  loadEndpointConfig,
  saveEndpointConfig,
  type EndpointConfig,
  type EndpointName,
} from "./endpoint-config";

const STORAGE_KEY = "endpointConfig";

/** Every configurable operation, read off the defaults so the list cannot drift. */
const ENDPOINT_NAMES = Object.keys(DEFAULT_ENDPOINT_CONFIG).filter(
  (key) => key !== "csrf",
) as EndpointName[];

let area: Record<string, unknown>;
let savedChrome: unknown;

beforeEach(() => {
  area = {};
  savedChrome = (globalThis as Record<string, unknown>).chrome;
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (key: string) => (key in area ? { [key]: area[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(area, items);
        },
      },
      onChanged: { addListener: () => {} },
    },
  };
});

afterEach(() => {
  (globalThis as Record<string, unknown>).chrome = savedChrome;
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

describe("saveEndpointConfig", () => {
  it("round-trips through storage", async () => {
    await saveEndpointConfig({ ...DEFAULT_ENDPOINT_CONFIG, deleteAd: "/custom/delete" });

    const config = await loadEndpointConfig();

    expect(config.deleteAd).toBe("/custom/delete");
  });

  // The content script drops its cached config on this signal, so the key the
  // watcher matches has to be the key the writer writes.
  it("writes the key isEndpointConfigChange watches", async () => {
    await saveEndpointConfig(DEFAULT_ENDPOINT_CONFIG);

    const changes = Object.fromEntries(
      Object.keys(area).map((key) => [key, { newValue: area[key] }]),
    );
    expect(isEndpointConfigChange(changes, "local")).toBe(true);
  });
});

describe("isEndpointConfigChange", () => {
  it("ignores other keys and other storage areas", () => {
    const change = { [STORAGE_KEY]: { newValue: DEFAULT_ENDPOINT_CONFIG } };

    expect(isEndpointConfigChange(change, "sync")).toBe(false);
    expect(isEndpointConfigChange({ somethingElse: { newValue: 1 } }, "local")).toBe(false);
  });
});
