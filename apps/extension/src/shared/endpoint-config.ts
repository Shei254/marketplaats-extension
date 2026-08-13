/**
 * The one definition of Marktplaats's internal endpoints + CSRF source.
 *
 * Runtime configuration, so a tester can paste discovered values (via the
 * Options page or the __setEndpoints console hook) and live-test WITHOUT editing
 * source or rebuilding. Persisted in chrome.storage.local; read by the content
 * script at call time, and by the background worker's dev hooks.
 *
 * This module is imported by every layer that needs the config — content script,
 * background worker, options page. There is deliberately no second copy: a
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

const STORAGE_KEY = "endpointConfig";

export async function loadEndpointConfig(): Promise<EndpointConfig> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const partial = stored[STORAGE_KEY] as Partial<EndpointConfig> | undefined;

    return {
        ...DEFAULT_ENDPOINT_CONFIG,
        ...partial,
        // Replaced wholesale, never merged: the CSRF variants carry different
        // fields, so a shallow merge could produce e.g. mode "none" still
        // carrying a stale `url`.
        csrf: partial?.csrf ?? DEFAULT_ENDPOINT_CONFIG.csrf,
    };
}

export async function saveEndpointConfig(config: EndpointConfig): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: config });
}

export function isEndpointConfigChange(
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
): boolean {
    return areaName === "local" && STORAGE_KEY in changes;
}
