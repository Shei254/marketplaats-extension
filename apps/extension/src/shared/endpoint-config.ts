import type { CsrfMode as ContractCsrfMode } from "@mprelist/contracts";

import { isServedConfigChange, readServedConfig } from "./served-config";

/**
 * The one definition of Marktplaats's internal endpoints + CSRF source.
 *
 * Runtime configuration, so a tester can retune a path that Marktplaats moved
 * (via the __setEndpoints console hook of a dev build) and live-test WITHOUT
 * editing source or rebuilding. Persisted in chrome.storage.local; read by the
 * content script at call time, and by the background worker's dev hooks. The
 * POC Options page that also wrote it is gone — ADR-0013.
 *
 * **Three sources now, in one order** (T27, #36). What ships in this file is the
 * bottom; the document the worker fetches from `GET /api/client-config` is laid
 * over it; and a tester's own overrides are laid over that. See
 * `loadEndpointConfig` for why the tester wins, which is the call ADR-0013 left
 * open and `docs/glossary.md` had been carrying as unanswered.
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
 *
 * **Before changing a path here, read `docs/internal-api-findings.md`** (T45, #53).
 * It records what the spikes actually found — which of these are HTML rather than
 * JSON, why `createAdPage` is pinned to one category's form, where the CSRF token
 * really comes from, and a table mapping each failure to the thing most likely to
 * have moved. The symptom is rarely at the endpoint whose name is in the error.
 */

/**
 * The four ways the token can be found. Imported from the wire contract rather
 * than restated, because since T27 (#36) a served document may name one — and a
 * mode this build spelled differently from the API's would be a document dropped
 * for a reason nobody could see.
 */
export type CsrfMode = ContractCsrfMode;

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

/**
 * The config as everything that calls Marktplaats sees it: **the build's
 * defaults, then whatever the backend served, then whatever this tester
 * overrode** (T27, #36).
 *
 * **The tester wins, and that is the call ADR-0013 left open.** Overrides exist
 * only in a `build:dev` bundle and are written by hand, by somebody who is
 * live-testing a path they are in the middle of working out
 * (`docs/live-testing.md`). A served document landing on top would silently undo
 * the one thing they are holding still — and it would do it minutes later,
 * remotely, while they were reading the result. The served document is for
 * everybody who has not made that choice, which is every real user, since none of
 * them can make it.
 *
 * **A served path this build has never heard of is dropped**, not carried. The
 * names are the keys of `DEFAULT_ENDPOINT_CONFIG` and nothing else, so a name a
 * newer release added reaches an older one as an unknown key and stops there —
 * which is what lets the API serve one document to every installed build.
 *
 * `csrf` is replaced wholesale at each layer rather than merged, for the reason
 * that was already here: the variants carry different fields, so a shallow merge
 * could produce a mode `none` still carrying a stale `url`.
 */
export async function loadEndpointConfig(): Promise<EndpointConfig> {
    const served = (await readServedConfig())?.config ?? null;
    const overrides = await readOverrides();

    return {
        ...DEFAULT_ENDPOINT_CONFIG,
        ...pathsThisBuildKnows(served?.endpoints ?? {}),
        ...overrides,
        csrf: overrides.csrf ?? served?.csrf ?? DEFAULT_ENDPOINT_CONFIG.csrf,
    };
}

/**
 * The served paths, minus any name this build does not have an endpoint for.
 *
 * The check is against the defaults' own keys — the same totality that makes a
 * missing default a compile error — so there is no second list of names to keep
 * in step with the first.
 */
function pathsThisBuildKnows(served: Record<string, string>): Partial<Record<EndpointName, string>> {
    const known: Partial<Record<EndpointName, string>> = {};
    for (const [name, path] of Object.entries(served)) {
        if (name !== "csrf" && name in DEFAULT_ENDPOINT_CONFIG) known[name as EndpointName] = path;
    }
    return known;
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

/**
 * Whether a storage change is one the resolved config depends on — **either
 * layer**, since T27 (#36) added the served one.
 *
 * The content script caches its config for its own lifetime and drops it on this,
 * so a served document that arrived while a marktplaats.nl tab sat open would go
 * unread until that tab was reloaded if this watched only the tester's key. Which
 * is the wrong half to watch: nobody but a tester ever writes the other one.
 */
export function isEndpointConfigChange(
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
): boolean {
    return areaName === "local" && (STORAGE_KEY in changes || isServedConfigChange(changes));
}
