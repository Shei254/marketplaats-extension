import { AdNotFoundError, NotAuthenticatedError, SpikePendingError } from "../domain/marktplaats-client";
import type {
  Bucket,
  CapturedAd,
  Category,
  CreateAdPageOptions,
  ListingDraft,
  Photo,
  RequestOptions,
  UploadPhoto
} from "../domain/types";
import { extractCsrfToken } from "./csrf";
import { ApiRequestError } from "../adapters/relay-marktplaats-client";
import {
  isEndpointConfigChange,
  loadEndpointConfig,
  type EndpointConfig,
  type EndpointName,
} from "../shared/endpoint-config";

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

export async function listMyAds(): Promise<ListingDraft[]> {
  const cfg = await config();
  const res = await request(cfg, "listMyAds");
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
  console.log("mappedBucket", mappedBucket);

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

export async function getBuckets(categoryId: number): Promise<Bucket[]> {
  const cfg = await config();
  const res = await request(cfg, "getBuckets", { pathParams: { parentCategoryId: categoryId } });
  return res.json();
}

export async function createAd(draft: CapturedAd, photos: Photo[]): Promise<void> {
  const cfg = await config();

  const uploadedMedia: UploadPhoto[] = await Promise.all(
      photos.map((photo) => uploadPhoto(cfg, photo))
  );

  // CRITICAL FIX: Use URLSearchParams for application/x-www-form-urlencoded
  const form = new URLSearchParams();

  uploadedMedia.forEach((media) => {
    form.append("images.ids", media.id);
    form.append("images.urls", media.imageUrl);
  });

  if (uploadedMedia.length) {
    form.append("images.ids", "");
  }

  form.append("title_nl-NL", draft.title || "");
  form.append("description_nl-NL", draft.description || "");

  // MOVED: Placed up here to match the working payload order
  form.append("url", "");
  form.append("url-input", "");

  draft.attributes.forEach(attr => {
    if (attr.attributeType == "SINGLE_SELECT") {
      form.append(`singleSelectAttribute[${attr.key}]`, attr.value);
    } else if (attr.attributeType == "MULTI_SELECT") {
      attr.values.forEach(val => {
        form.append(`multiSelectAttribute[${attr.key}]`, val.value);
      })
    }
  })

  if (draft.deliveryMethod) form.append("deliveryMethod", draft.deliveryMethod);

  if (draft.isBuyerProtectionActiveOnListing) {
    form.append("buyerProtectionAllowed", "on");
  }

  const shippingInformation = draft.shippingInformation.selectedShippingOptions;

  if (shippingInformation) {
    const uniqueShippingInfo = [...new Map(shippingInformation.map(info => [info.carrierId, info])).values()]
    uniqueShippingInfo.forEach(info => {
      form.append("shippingMethod", info.carrierId.toLowerCase());
    })

    form.append("shippingDetails.price", shippingInformation?.[0]?.cost || "");
    form.append("shippingDetails.provider", "other");
  } else {
    draft.shippingInformation.augmentedLabels.forEach(label => {
      if (label.carrierId == null) {
        form.append("shippingMethod", "diy");
        form.append("othersPrice", label.labels?.[0]?.price || "")
      }
    })
  }

  const dropOffCode = draft.contactInformation?.postcode;
  if (dropOffCode) {
    form.append("dropOffLocationCode", dropOffCode);
  }

  form.append("packageSize", "M");

  if (draft.price) {
    const priceType = draft.price.priceType;

    form.append("Dropdown-prijstype", priceType);
    form.append("price.typeValue", priceType);

    if (priceType != "FREE" && priceType != "SEE_DESCRIPTION") {
      if (priceType === "MIN_BID") {
        form.append("Dropdown-prijstype", "FIXED");
        form.append("price.minimumBidPrice", String(Number(draft.price.minimumBidPriceCent) / 100));
      }
      form.append("price.value", String(Number(draft.price.priceCent) / 100));
    }

    form.append("previousPriceType", "");

    // MOVED: minimumBidPrice is placed before typeValue in the working payload
    // FIXED: Only append if true. Omit entirely if false.
    if (draft.price.biddingEnabled) {
      form.append("price.biddingEnabled", "on");
    } else {
      form.append("price.biddingEnabled", "off");
    }
  }

  form.append("contactInformation.sellerName", draft.contactInformation.name || "");
  // FIXED: Cast boolean to string, and reordered before syi-address fields
  form.append("contactInformation.phoneNumberSwitch", "false");
  form.append("syi-address-radio-home", "syi-address-nl");
  form.append("address-index-filter", "syi-address-nl");
  form.append("contactInformation.postCode", draft.contactInformation.postcode || "");
  form.append("bundle-selection", "FREE");
  form.append("selectedBundle", "FREE");

  const csrfToken = await ensureCsrfToken(cfg);
  if (csrfToken) form.append("xsrf.token", csrfToken);

  if (draft.categoryInformation) {
    form.append("l1", String(draft.categoryInformation.parentCategoryId));
    // MOVED: Bucket must be grouped with the category IDs
    form.append("bucket", String(draft.bucketId || 9));
    form.append("l2", String(draft.categoryInformation.categoryId));
    form.append("l2CategoryFullName", draft.categoryInformation.categoryName || "");
  }

  const formAttributes = await getCreateFormAttributes(cfg);

  // Reordered to strictly match the working payload's exact sequence
  form.append("tmsid", formAttributes.tmsid);
  form.append("timestamp", String(formAttributes.timestamp));
  form.append("signature", formAttributes.signature);

  // request() throws on any non-ok status, so reaching here means the ad was
  // created — Marktplaats answers with 200/201/a redirect and no JSON to read.
  await request(cfg, "createAd", {
    init: {
      method: "POST",
      body: form
    },
  });

  console.log("Ad Created Successfully");
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

  console.log("html text response", html);

  const windowConfig = (await captureAdViaJson(html)) ?? (await captureAdViaWindowConfig(html)) ;
  console.log("createAdFormAttributes", windowConfig);
  return {
    signature: windowConfig.reactData.form.signature,
    timestamp: windowConfig.reactData.form.timestamp,
    tmsid:  windowConfig.reactData.form.tmsid
  }
}