import {
  AdNotFoundError,
  DraftUnusableError,
  NotAuthenticatedError,
  SpikePendingError
} from "../domain/marktplaats-client";
import type {
  AdPresence,
  Bucket,
  CapturedAd,
  Category,
  CreateAdPageOptions, CreateFormAttributes, DraftPage,
  ListingDraft,
  Photo,
  RequestOptions,
  UploadPhoto
} from "../domain/types";
import { extractCsrfToken } from "./csrf";
import { ApiRequestError } from "../domain/marktplaats-client";
import {
  isEndpointConfigChange,
  loadEndpointConfig,
  type EndpointConfig,
  type EndpointName,
} from "../shared/endpoint-config";
import {buildCreateForm} from "./utils";

// ============================================================================
// Configuration
// ============================================================================

/**
 * The config itself lives in ../shared/endpoint-config — one definition for the
 * content script and the background worker. What is local to
 * this module is only the caching: the config and the CSRF token are read once
 * per content-script lifetime and dropped when the stored config changes.
 */
let cachedConfig: EndpointConfig | null = null;
let cachedCsrfToken: string | null = null;
let activeRefreshPromise: Promise<string> | null = null;

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (isEndpointConfigChange(changes, areaName)) {
    cachedConfig = null;
    cachedCsrfToken = null;
  }
});

async function config(): Promise<EndpointConfig> {
  if (!cachedConfig) cachedConfig = await loadEndpointConfig();
  return cachedConfig;
}

// ============================================================================
// Core Request Logic
// ============================================================================

function pathOf(
    cfg: EndpointConfig,
    name: EndpointName,
    params?: Record<string, string | number>,
    queries?: Record<string, string | number>
): string {
  let path = cfg[name];
  if (!path) {
    throw new SpikePendingError(`Endpoint '${name}' is not set in the endpoint config.`);
  }

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      const regex = new RegExp(`:${key}(?!\\w)`, "g");
      path = path.replace(regex, encodeURIComponent(String(value)));
    }
  }

  if (queries) {
    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(queries)) {
      searchParams.append(key, String(value))
    }

    const queryString = searchParams.toString();
    if (queryString) {
      path += path.includes("?") ? `&${queryString}` : `?${queryString}`
    }
  }

  if (path.includes(":")) {
    console.warn(`[pathOf] URL '${path}' may contain unresolved path variables.`);
  }

  return path;
}

async function ensureCsrfToken(cfg: EndpointConfig, forceRefresh = false): Promise<string> {
  if (cfg.csrf.mode === "none") return "";
  if (!forceRefresh && cachedCsrfToken) return cachedCsrfToken;

  if (!activeRefreshPromise) {
    activeRefreshPromise = (async () => {
      try {
        const token = await extractCsrfToken(cfg.csrf);
        if (!token) throw new SpikePendingError("CSRF token extraction failed. Token not found.");
        cachedCsrfToken = token;
        return token;
      } finally {
        activeRefreshPromise = null;
      }
    })();
  }

  return activeRefreshPromise;
}

async function request(
    cfg: EndpointConfig,
    name: EndpointName,
    { init = {}, listingId, pathParams = {}, notFoundIsMissing, queryParams }: RequestOptions = {}
): Promise<Response> {
  // FIX: Immutably merge parameters so we don't pollute the caller's pathParams object
  const mergedParams: Record<string, string | number> = { ...pathParams };
  if (listingId !== undefined) {
    mergedParams.id = listingId;
  }

  const url = pathOf(cfg, name, mergedParams, queryParams);
  const method = init.method?.toUpperCase() ?? "GET";
  const requiresCsrf = ["POST", "PUT", "DELETE", "PATCH"].includes(method);

  const headers = new Headers(init.headers);

  if (requiresCsrf) {
    const token = await ensureCsrfToken(cfg);
    if (token) headers.set(cfg.csrf.header, token);
  }

  let res = await fetch(url, { credentials: "include", ...init, headers });

  if (requiresCsrf && (res.status === 403 || res.status === 419)) {
    console.warn(`[${name}] Token expired. Fetching fresh token and retrying...`);
    const freshToken = await ensureCsrfToken(cfg, true);
    headers.set(cfg.csrf.header, freshToken);
    res = await fetch(url, { credentials: "include", ...init, headers });
  }

  if (notFoundIsMissing && res.status === 404 && mergedParams.id !== undefined) {
    throw new AdNotFoundError(String(mergedParams.id));
  }

  if (res.status === 401 || res.status === 403) {
    throw new NotAuthenticatedError();
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "Could not read response body");
    console.error(`[Marktplaats API] ${method} ${url} failed with ${res.status}:`, bodyText);
    throw new ApiRequestError(name, res.status, bodyText);
  }

  return res;
}

// ============================================================================
// Business Logic Functions
// ============================================================================
export async function listMyAdsPage(batchNumber?: number, batchSize?: number): Promise<DraftPage> {
  const cfg = await config();
  // Page 1 is the request with no parameters; they appear only from page 2.
  const queryParams =
      batchNumber !== undefined && batchSize !== undefined ? { batchNumber, batchSize } : undefined;
  const res = await request(cfg, "listMyAds", { queryParams });
  const data = await res.json();
  const ads: ListingDraft[] = data.ads ?? [];
  // A payload without a total means no further pages, not a TypeError.
  return { ads, totalNumberOfResults: data.totalNumberOfResults ?? ads.length };
}


export async function listMyAds(batchNumber?: number, batchSize?: number): Promise<ListingDraft[]> {
  const cfg = await config();
  const queryParams = batchNumber && batchSize ? { batchNumber, batchSize } : undefined
  const res = await request(cfg, "listMyAds", { queryParams });
  const data = await res.json();
  return data.ads ?? [];
}

export async function captureAd(listingId: string): Promise<{ draft: CapturedAd; photos: Photo[] }> {
  const cfg = await config();
  const res = await request(cfg, "captureAd", { pathParams: { id: listingId } });
  const html = await res.text();

  const windowConfig = (await captureAdViaJson(html)) ?? (await captureAdViaWindowConfig(html)) ;

  if (!windowConfig) throw new AdNotFoundError(listingId);

  const draft: CapturedAd = windowConfig.listing ?? windowConfig;
  if (!draft) throw new AdNotFoundError(listingId);

  const photoUrls: string[] = draft.gallery?.imageUrls ?? [];
  const photos = await Promise.all(photoUrls.map((url) => downloadPhoto(url)));

  const buckets = await getBuckets(draft.categoryInformation.parentCategoryId);

  const mappedBucket = await mapCategoryToBucket(cfg, draft.categoryInformation.categoryId, draft.categoryInformation.parentCategoryId, buckets);
  // Guards mappedBucket, not draft: a null bucket used to fall through to
  // `mappedBucket.id` and throw an opaque TypeError instead of this message.
  if (!mappedBucket) throw new SpikePendingError("Could not resolve a mapped bucket");

  draft.bucketId = mappedBucket.id;

  return { draft, photos };
}

/**
 * The user's own ads, filtered by Marktplaats rather than here — the same path
 * `listMyAds` calls, plus a `query` parameter.
 *
 * `?? []` for `listMyAds`'s reason and one more: **a search that matches nothing
 * is the ordinary case**, reached by typing, and a payload that answers it without
 * an `ads` key would otherwise be a `TypeError` in the caller rather than an empty
 * list on the screen. Nothing is logged: since T31 (#40) this runs on a debounce
 * while somebody types, and what they type is theirs and not ours to print into
 * the console of a page we are a guest on.
 */
export async function searchAd (query: string): Promise<ListingDraft[]> {
  const cfg = await config();
  const res = await request(cfg, "searchAd", { queryParams: { query } });

  const data = await res.json();
  return data.ads ?? [];
}

export async function mapCategoryToBucket(
    cfg: EndpointConfig,
    categoryId: number,
    parentCategoryId: number,
    buckets: Bucket[],
): Promise<Bucket | null> {
  if (!buckets || buckets.length === 0) return null;

  // Optimized: Use Promise.all to fetch concurrently and return the first valid bucket
  const results = await Promise.all(buckets.map(async (bucket) => {
    try {
      const res = await request(cfg, "getBucketCategories", {
        pathParams: { parentCategoryId, bucketId: bucket.id }
      });
      const categories: Category[] = await res.json();
      return categories.some((c) => c.id === categoryId) ? bucket : null;
    } catch (e) {
      console.warn(`Failed to fetch categories for bucket ${bucket.id}`, e);
      return null;
    }
  }));

  return results.find((result) => result !== null) || null;
}

export async function downloadPhoto(url: string): Promise<Photo> {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (res.ok) {
      const blob = await res.blob();
      const data = new Uint8Array(await blob.arrayBuffer());
      const filename = new URL(url, location.href).pathname.split("/").pop() || "photo.jpg";
      return { filename, mimeType: blob.type || "image/jpeg", data };
    }
  } catch (err) {
    console.warn(`[DownloadPhoto] Direct fetch failed for ${url}, attempting canvas fallback:`, err);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Failed to initialize canvas context"));

      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("Canvas blob conversion failed"));
        blob.arrayBuffer().then((buffer) => {
          const filename = new URL(url, location.href).pathname.split("/").pop() || "photo.jpg";
          resolve({
            filename,
            mimeType: blob.type || "image/jpeg",
            data: new Uint8Array(buffer),
          });
        }).catch(reject);
      }, "image/jpeg", 0.95);
    };
    img.onerror = () => reject(new Error(`Failed to load image element for URL: ${url}`));
    img.src = url;
  });
}

export async function deleteAd(listingId: string): Promise<void> {
  const cfg = await config();
  await request(cfg, "deleteAd", {
    listingId,
    notFoundIsMissing: true,
    init: {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: listingId, reason: "NO_DEAL_VIA_MP" }),
    },
  });
}

/**
 * Mark an ad as **Gereserveerd** (T71, #157) — observed 2026-09-07 in DevTools.
 *
 * `deleteAd`'s body shape minus the `reason`, and a PUT rather than a DELETE, so
 * it takes `request()`'s mutating branch and gets the `x-mp-xsrf` header and the
 * one 403/419 refresh-and-retry for free.
 *
 * **No `notFoundIsMissing`**, unlike `deleteAd`. That flag exists so the
 * orchestrator can treat an already-gone ad as a delete that succeeded; there is
 * no equivalent reading here, because an ad that is not there is an ad we cannot
 * flag. A 404 stays an `ApiRequestError` and the caller logs it — which is the
 * whole of the failure handling this call gets (ADR-0028).
 *
 * `listingId` is passed as well as written into the body so a configured path
 * carrying `:id` resolves. The observed path has none.
 */
export async function reserveAd(listingId: string): Promise<void> {
  const cfg = await config();
  await request(cfg, "reserveAd", {
    listingId,
    init: {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: listingId }),
    },
  });
}

export async function getBuckets(categoryId: number): Promise<Bucket[]> {
  const cfg = await config();
  const res = await request(cfg, "getBuckets", { pathParams: { parentCategoryId: categoryId } });
  return res.json();
}

function buildForm(
    draft: CapturedAd,
    uploadedMedia: UploadPhoto[],
    csrfToken: string,
    formAttributes: CreateFormAttributes,
): URLSearchParams {
  try {
    return buildCreateForm(draft, uploadedMedia, csrfToken, formAttributes);
  } catch (error) {
    console.error("[createAd] draft could not be turned into a form", error);
    throw new DraftUnusableError(error instanceof Error ? error.message : String(error));
  }
}

export async function createAd(draft: CapturedAd, photos: Photo[]): Promise<void> {
  const cfg = await config();

  // Dry run first. The form is a pure function of the draft, so a draft that
  // cannot produce one is found out here, before a single photo is uploaded.
  buildForm(draft, [], "", { tmsid: "", timestamp: 0, signature: "" });

  const uploadedMedia: UploadPhoto[] = await Promise.all(
      photos.map((photo) => uploadPhoto(cfg, photo)),
  );
  const csrfToken = await ensureCsrfToken(cfg);
  const formAttributes = await getCreateFormAttributes(cfg);

  const form = buildForm(draft, uploadedMedia, csrfToken, formAttributes);

  // request() throws on any non-ok status, so reaching here means the ad was
  // created — Marktplaats answers with 200/201/a redirect and no JSON to read.
  await request(cfg, "createAd", { init: { method: "POST", body: form } });

}
// FIX: Returned a single UploadPhoto instead of an array.
async function uploadPhoto(cfg: EndpointConfig, photo: Photo): Promise<UploadPhoto> {
  const buffer = new ArrayBuffer(photo.data.byteLength);
  new Uint8Array(buffer).set(photo.data);

  const form = new FormData();
  form.append("name", photo.filename);
  form.append("imageData", new Blob([buffer], { type: photo.mimeType }), photo.filename);

  const res = await request(cfg, "uploadPhoto", {
    init: { method: "POST", body: form },
  });
  return res.json();
}

export async function probeAd (listingId: string): Promise<AdPresence> {
  try {
    const cfg = await config();
    const url = pathOf(cfg, "captureAd", { id: listingId });
    const res = await fetch(url, { credentials: "include" });

    if (res.status === 404 || res.status === 410) return "gone";
    if (!res.ok) return "unknown"

    const html = await res.text()
    const state = (await captureAdViaJson(html)) ?? (await captureAdViaWindowConfig(html));
    const ad = state?.listing ?? state;
    // Same field captureAd depends on. A 200 page without it is a layout change or
    // a "no longer available" page, never proof that the ad is alive.
    return ad?.categoryInformation ? "exists" : "unknown";
  } catch (e) {
    console.error("[probeAd] probing ad failed", e);
    return "unknown"
  }
}


// ============================================================================
// Hydration Parsing Helpers
// ============================================================================

export async function captureAdViaJson(htmlText: string): Promise<any> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");

  const nextDataScript = doc.querySelector("script#__NEXT_DATA__[type='application/json']");
  if (nextDataScript?.textContent) {
    return JSON.parse(nextDataScript.textContent);
  }

  const apolloScript = doc.querySelector("script#__APOLLO_STATE__[type='application/json']");
  if (apolloScript?.textContent) {
    return JSON.parse(apolloScript.textContent);
  }

  return null;
}

export async function captureAdViaWindowConfig(htmlText: string): Promise<any> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");
  const scripts = Array.from(doc.querySelectorAll("script:not([src])"));

  for (const script of scripts) {
    const text = script.textContent || "";
    if (text.includes("window.__CONFIG__")) {
      const match = text.match(/window\.__CONFIG__\s*=\s*(\{[\s\S]*?\});?\s*(<\/script>|$|window\.)/);
      if (match && match[1]) {
        try {
          return JSON.parse(match[1]);
        } catch (e) {
          console.error("[Parser] JSON parse error on window config state:", e);
        }
      } else {
        console.warn("[Capture] Found window.__CONFIG__ but couldn't isolate the JSON structure.");
      }
    }
  }

  return null;
}

export async function getCreateFormAttributes (cfg: EndpointConfig): Promise<{
  signature: string,
  timestamp: number,
  tmsid: string
}> {
  const res = await request(cfg, "createAdPage");
  const html = await res.text();

  const windowConfig = (await captureAdViaJson(html)) ?? (await captureAdViaWindowConfig(html)) ;
  return {
    signature: windowConfig.reactData.form.signature,
    timestamp: windowConfig.reactData.form.timestamp,
    tmsid:  windowConfig.reactData.form.tmsid
  }
}