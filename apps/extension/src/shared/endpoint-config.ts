/**
 * The one definition of Marktplaats's internal endpoints + CSRF source.
 *
 * Runtime configuration, so a tester can retune a path that Marktplaats moved
 * (via the __setEndpoints console hook of a dev build) and live-test WITHOUT
 * editing source or rebuilding. Persisted in chrome.storage.local; read by the
 * content script at call time, and by the background worker's dev hooks. The
 * POC Options page that also wrote it is gone — ADR-0013, whose backend-served
 * replacement is #36.
 *
 * This module is imported by every layer that needs the config — content script
 * and background worker. There is deliberately no second copy: a
 * duplicate drifted once already (it declared `getBucket` while the type said
 * `getBuckets`, so that endpoint was unreachable from a stored config), which is
 * what T02 removed. `DEFAULT_ENDPOINT_CONFIG` is typed as a *total* record over
 * `EndpointName` precisely so that class of drift is a compile error: a new name
 * without a default fails to build, and a misspelt key is an excess property.
 *
 * An endpoint that is somehow unset surfaces as a SpikePendingError at call time
 * rather than failing to construct.
 */
export type CsrfMode = "meta" | "cookie" | "none" | "fetch";

export interface BaseCsrfConfig {
  header: string;
}

export interface NoneCsrfConfig extends BaseCsrfConfig {
  mode: "none";
}

export interface MetaCsrfConfig extends BaseCsrfConfig {
  mode: "meta";
  name: string;
}

export interface CookieCsrfConfig extends BaseCsrfConfig {
  mode: "cookie";
  name: string;
}

export interface FetchCsrfConfig extends BaseCsrfConfig {
  mode: "fetch";
  url: string;
  extractor:
    | { type: "dom"; selector: string; attribute: string }
    | { type: "regex"; pattern: RegExp; matchIndex: number };
}

export type CsrfConfig =
    | NoneCsrfConfig
    | MetaCsrfConfig
    | CookieCsrfConfig
    | FetchCsrfConfig;


/**
 * The internal-API operations whose paths are configured at runtime.
 *
 * `downloadPhoto` is not one of them and never was: it fetches the absolute URLs
 * carried in the captured ad's own payload, so it has no configurable path. It
 * used to sit in this union anyway, where it could only ever be dead weight.
 */
export type EndpointName =
  | "listMyAds" // GET → the user's ads.
  | "searchAd" // GET → the user's ads filtered by a `query` param.
  | "captureAd" // GET (HTML) → one ad's full detail. Contains ":id".
  | "deleteAd" // DELETE → remove an ad.
  | "createAd" // POST (urlencoded) → create a new ad.
  | "createAdPage" // GET (HTML) → the create form, scraped for signature/timestamp/tmsid.
  | "uploadPhoto" // POST (multipart) → upload one photo, returns a media id.
  | "getBuckets" // GET → a parent category's buckets. Contains ":parentCategoryId".
  | "getBucketCategories"; // GET → one bucket's categories. Contains ":parentCategoryId" and ":bucketId".

/**
 * Every endpoint is optional here: a stored config may carry only the keys the
 * tester overrode, and the rest fall back to `DEFAULT_ENDPOINT_CONFIG`.
 * (`Record<Partial<EndpointName>, …>` did not mean this — Partial over a string
 * union is not a no-op, and it made every key required.)
 */
export type EndpointConfig = Partial<Record<EndpointName, string>> & {
    csrf: CsrfConfig;
};

/**
 * The endpoints as discovered by the POC spikes. Total over `EndpointName` — see
 * the module docstring for why that totality is load-bearing.
 */
export const DEFAULT_ENDPOINT_CONFIG: Record<EndpointName, string> & { csrf: CsrfConfig } = {
    listMyAds: "/my-account/sell/api/listings",
    searchAd: "/my-account/sell/api/listings",
    captureAd: "/seller/view/:id",
    deleteAd: "/seller/api/delete-ad",
    createAd: "/plaats/ads",
    createAdPage: "/plaats/1744/1745",
    uploadPhoto: "/plaats/api/image/upload",
    getBuckets: "/plaats/api/v1/category-aggregate/:parentCategoryId/buckets",
    getBucketCategories: "/plaats/api/v1/category-aggregate/:parentCategoryId/buckets/:bucketId/categories",
    csrf: {
        mode: "fetch",
        url: "https://www.marktplaats.nl/plaats/1/2",
        header: "x-mp-xsrf",
        extractor: {
            type: "dom",
            selector: "input[name='xsrf.token']",
            attribute: "value"
        }
    },
};

/**
 * What the tester overrode — not a config. The name matters, because the key it
 * replaces holds something different.
 *
 * `endpointConfig` was written by the POC Options page and by `__setEndpoints`
 * before it stored overrides, and what it holds is a *resolved* config: every
 * endpoint pinned at the defaults of whichever build first wrote it. Reading that
 * value as overrides would reintroduce the exact bug storing overrides fixed —
 * a later build correcting a path could never reach the profile, and the symptom
 * was a 404 on a path the tester never touched. There is no way to tell such a
 * value apart from a tester who genuinely overrode all nine, so it is not
 * migrated: a new key means the stale profile is simply never read again, and
 * everything falls back to the build's defaults, which is the correct state.
 */
const STORAGE_KEY = "endpointOverrides";

/** The pre-override key. Read by nothing; dropped when overrides are next written. */
const LEGACY_STORAGE_KEY = "endpointConfig";

/**
 * The stored overrides, or `{}` when nothing has been overridden. One reader, so
 * the unchecked cast across the storage boundary lives in one place.
 */
async function readOverrides(): Promise<Partial<EndpointConfig>> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return (stored[STORAGE_KEY] as Partial<EndpointConfig> | undefined) ?? {};
}

export async function loadEndpointConfig(): Promise<EndpointConfig> {
    const overrides = await readOverrides();

    return {
        ...DEFAULT_ENDPOINT_CONFIG,
        ...overrides,
        // Replaced wholesale, never merged: the CSRF variants carry different
        // fields, so a shallow merge could produce e.g. mode "none" still
        // carrying a stale `url`.
        csrf: overrides.csrf ?? DEFAULT_ENDPOINT_CONFIG.csrf,
    };
}

/**
 * Merge `overrides` into the tester's stored *overrides* — not into the resolved
 * config. Returns the overrides now in effect, so a console caller can see what
 * they are actually carrying; `loadEndpointConfig` is what shows the paths those
 * overrides resolve to.
 *
 * The distinction is the whole point of this function. Writing the *resolved*
 * config back — defaults merged in, which is what `loadEndpointConfig` hands you
 * — pinned all nine endpoints at the running build's defaults the first time a
 * tester overrode any one of them. A later build correcting a different path
 * then never reached that profile, and the symptom was a 404 on a path they
 * never touched, unrelated to the override they remembered making. Storing only
 * what was overridden leaves every other endpoint free to follow the build.
 *
 * `csrf` is replaced wholesale here for the same reason `loadEndpointConfig`
 * replaces it rather than merging: the four variants carry different fields.
 */
export async function saveEndpointOverrides(
    overrides: Partial<EndpointConfig>,
): Promise<Partial<EndpointConfig>> {
    const merged = { ...(await readOverrides()), ...overrides };

    await chrome.storage.local.set({ [STORAGE_KEY]: merged });
    // Swept here rather than on read: this is the one writer, and a tester
    // rewriting their profile is the moment the stale resolved config becomes
    // dead weight. Harmless if absent.
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
    return merged;
}

export function isEndpointConfigChange(
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
): boolean {
    return areaName === "local" && STORAGE_KEY in changes;
}
