import {
  AdNotFoundError,
  NotAuthenticatedError,
  SpikePendingError,
} from "../domain/marktplaats-client";
import type { CapturedAd, ListingDraft, ListingSummary, Photo } from "../domain/types";
import {
  isEndpointConfigChange,
  loadEndpointConfig,
  type EndpointConfig,
  type EndpointName,
} from "../shared/endpoint-config";
import { csrfHeaders } from "./csrf";

/**
 * The real internal-API calls (ADR-0004), running INSIDE the marktplaats.nl page
 * via the content script, so they carry the user's session cookies and can read
 * the page's CSRF token.
 *
 * Endpoints + CSRF source come from runtime config (Options page / __setEndpoints),
 * NOT hardcoded — so they can be tuned during live testing without a rebuild. An
 * unset endpoint throws SpikePendingError. Filling these is spike #2/#3/#4.
 */

let cachedConfig: EndpointConfig | null = null;

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (isEndpointConfigChange(changes, areaName)) cachedConfig = null;
});

async function config(): Promise<EndpointConfig> {
  if (!cachedConfig) cachedConfig = await loadEndpointConfig();
  return cachedConfig;
}

function pathOf(cfg: EndpointConfig, name: EndpointName, listingId?: string): string {
  const path = cfg[name];
  if (path === "") {
    throw new SpikePendingError(`endpoint '${name}' is not set — configure it in the extension's Options`);
  }
  return listingId ? path.replace(":id", encodeURIComponent(listingId)) : path;
}

interface RequestOptions {
  init?: RequestInit;
  /** substituted into the path's ":id" and used for AdNotFoundError on 404. */
  listingId?: string;
  /** when true, a 404 becomes AdNotFoundError (so the orchestrator treats it as already-deleted). */
  notFoundIsMissing?: boolean;
}

/** One place for the fetch → auth-guard → ok-guard shape shared by every call. */
async function request(
  cfg: EndpointConfig,
  name: EndpointName,
  { init, listingId, notFoundIsMissing }: RequestOptions = {},
): Promise<Response> {
  const res = await fetch(pathOf(cfg, name, listingId), { credentials: "include", ...init });
  if (notFoundIsMissing && res.status === 404 && listingId !== undefined) {
    throw new AdNotFoundError(listingId);
  }
  if (res.status === 401 || res.status === 403) throw new NotAuthenticatedError();
  if (!res.ok) throw new Error(`${name} failed: ${res.status}`);
  return res;
}

export async function listMyAds(): Promise<ListingSummary[]> {
  const cfg = await config();
  const res = await request(cfg, "listMyAds");
  const data = await res.json();
  // TODO(spike #2): map the real response shape → ListingSummary[].
  return (data.ads ?? []).map(
    (ad: { id: string | number; title: string; priceCents: number }): ListingSummary => ({
      id: String(ad.id),
      title: ad.title,
      priceCents: ad.priceCents,
    }),
  );
}

export async function captureAd(listingId: string): Promise<CapturedAd> {
  const cfg = await config();
  const res = await request(cfg, "captureAd", { listingId, notFoundIsMissing: true });
  const data = await res.json();
  // TODO(spike #2/#4): map the real detail response → draft + photo URLs.
  const draft: ListingDraft = {
    title: data.title,
    description: data.description,
    priceCents: data.priceCents,
    categoryId: String(data.categoryId),
    attributes: data.attributes ?? {},
    location: data.location,
  };
  const photoUrls: string[] = data.pictureUrls ?? [];
  const photos = await Promise.all(photoUrls.map(downloadPhoto));
  return { draft, photos };
}

async function downloadPhoto(url: string): Promise<Photo> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`photo download failed: ${res.status}`);
  const blob = await res.blob();
  const data = new Uint8Array(await blob.arrayBuffer());
  const filename = new URL(url, location.href).pathname.split("/").pop() || "photo.jpg";
  return { filename, mimeType: blob.type || "image/jpeg", data };
}

export async function deleteAd(listingId: string): Promise<void> {
  const cfg = await config();
  await request(cfg, "deleteAd", {
    listingId,
    notFoundIsMissing: true,
    init: { method: "DELETE", headers: csrfHeaders(cfg.csrf) },
  });
}

export async function createAd(draft: ListingDraft, photos: Photo[]): Promise<{ id: string }> {
  const cfg = await config();
  const csrf = csrfHeaders(cfg.csrf);
  const mediaIds = await Promise.all(photos.map((photo) => uploadPhoto(cfg, csrf, photo)));
  const res = await request(cfg, "createAd", {
    init: {
      method: "POST",
      headers: { "content-type": "application/json", ...csrf },
      // TODO(spike #3): assemble the real create payload from draft + mediaIds.
      body: JSON.stringify({ ...draft, mediaIds }),
    },
  });
  const data = await res.json();
  // TODO(spike #3): confirm the new-listing id field.
  return { id: String(data.id) };
}

async function uploadPhoto(
  cfg: EndpointConfig,
  csrf: Record<string, string>,
  photo: Photo,
): Promise<string> {
  const buffer = new ArrayBuffer(photo.data.byteLength);
  new Uint8Array(buffer).set(photo.data);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: photo.mimeType }), photo.filename);
  const res = await request(cfg, "uploadPhoto", {
    init: { method: "POST", headers: csrf, body: form },
  });
  const data = await res.json();
  // TODO(spike #4): confirm the media id field.
  return String(data.id);
}
