/**
 * Runtime configuration of Marktplaats's internal endpoints + CSRF source, so a
 * tester can paste discovered values (via the Options page or the __setEndpoints
 * console hook) and live-test WITHOUT editing source or rebuilding. Persisted in
 * chrome.storage.local; read by the content script at call time.
 *
 * This is what the spikes (#2/#3/#4) fill in. An unset endpoint surfaces as a
 * SpikePendingError telling the tester to configure it.
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
  mode: "fetch"
  url: string;
  extractor: { type: "dom"; selector: string; attribute: string } | { type: "regex", pattern: RegExp, matchIndex: number }
}

export type CsrfConfig =
    | NoneCsrfConfig
    | MetaCsrfConfig
    | CookieCsrfConfig
    | FetchCsrfConfig;


/** The internal-API operations whose paths are configured at runtime. */
export type EndpointName =
  | "listMyAds" // GET → the user's ads.
  | "captureAd" // GET → one ad's full detail. May contain ":id".
  | "deleteAd" // DELETE → remove an ad. May contain ":id".
  | "createAd" // POST → create a new ad.
  | "uploadPhoto"
  | "getBuckets"
  | "getBucketCategories"
  | "downloadPhoto"// POST (multipart) → upload one photo, returns a media id.// ;
  | "createAdPage"
  | "searchAd"


// 1. Fix the type definition using an intersection
export type EndpointConfig = Record<Partial<EndpointName>, string> & {
    csrf: CsrfConfig;
};

export const EMPTY_ENDPOINT_CONFIG: EndpointConfig = {
    listMyAds: "/my-account/sell/api/listings",
    captureAd: "/seller/view/:id",
    deleteAd: "/seller/api/delete-ad",
    createAd: "/plaats/ads",
    createAdPage: "/plaats/1744/1745",
    uploadPhoto: "/plaats/api/image/upload",
    getBucket: "/plaats/api/v1/category-aggregate/:parentCategoryId/buckets",
    getBucketCategories: "/plaats/api/v1/category-aggregate/:parentCategoryId/buckets/:bucketId/categories",
    searchAd: "/my-account/sell/api/listings",
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
        ...EMPTY_ENDPOINT_CONFIG,
        ...partial,
        // 2. Safely replace the CSRF config without merging incompatible properties
        csrf: partial?.csrf ?? EMPTY_ENDPOINT_CONFIG.csrf,
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