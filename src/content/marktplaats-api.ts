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
} from "../shared/endpoint-config";

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

function pathOf(cfg: EndpointConfig, name: keyof EndpointConfig, listingId?: string): string {
  const path = cfg[name];
  if (typeof path !== "string" || path === "") {
    throw new SpikePendingError(`endpoint '${name}' is not set — configure it in the extension's Options`);
  }
  return listingId ? path.replace(":id", encodeURIComponent(listingId)) : path;
}

async function csrfHeaders(cfg: EndpointConfig): Promise<Record<string, string>> {
  if (cfg.csrf.mode === "none") return {};
  const token = readCsrfToken(cfg);
  if (!token) {
    throw new SpikePendingError(
      `CSRF token (${cfg.csrf.mode} '${cfg.csrf.name}') not found — check the Options config`,
    );
  }
  return { [cfg.csrf.header]: token };
}

function readCsrfToken(cfg: EndpointConfig): string | undefined {
  if (cfg.csrf.mode === "meta") {
    return document.querySelector(`meta[name="${cfg.csrf.name}"]`)?.getAttribute("content") ?? undefined;
  }
  // cookie (must be non-HttpOnly to be readable here).
  const prefix = `${cfg.csrf.name}=`;
  const cookie = document.cookie.split("; ").find((c) => c.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : undefined;
}

function assertAuthed(status: number): void {
  if (status === 401 || status === 403) throw new NotAuthenticatedError();
}

export async function listMyAds(): Promise<ListingSummary[]> {
  const cfg = await config();
  const res = await fetch(pathOf(cfg, "listMyAds"), { credentials: "include" });
  assertAuthed(res.status);
  if (!res.ok) throw new Error(`listMyAds failed: ${res.status}`);
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
  const res = await fetch(pathOf(cfg, "captureAd", listingId), { credentials: "include" });
  if (res.status === 404) throw new AdNotFoundError(listingId);
  assertAuthed(res.status);
  if (!res.ok) throw new Error(`captureAd failed: ${res.status}`);
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
  const res = await fetch(pathOf(cfg, "deleteAd", listingId), {
    method: "DELETE",
    credentials: "include",
    headers: await csrfHeaders(cfg),
  });
  if (res.status === 404) throw new AdNotFoundError(listingId);
  assertAuthed(res.status);
  if (!res.ok) throw new Error(`deleteAd failed: ${res.status}`);
}

export async function createAd(draft: ListingDraft, photos: Photo[]): Promise<{ id: string }> {
  const cfg = await config();
  const csrf = await csrfHeaders(cfg);
  const mediaIds = await Promise.all(photos.map((photo) => uploadPhoto(cfg, csrf, photo)));
  const res = await fetch(pathOf(cfg, "createAd"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", ...csrf },
    // TODO(spike #3): assemble the real create payload from draft + mediaIds.
    body: JSON.stringify({ ...draft, mediaIds }),
  });
  assertAuthed(res.status);
  if (!res.ok) throw new Error(`createAd failed: ${res.status}`);
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
  const res = await fetch(pathOf(cfg, "uploadPhoto"), {
    method: "POST",
    credentials: "include",
    headers: csrf,
    body: form,
  });
  if (!res.ok) throw new Error(`uploadPhoto failed: ${res.status}`);
  const data = await res.json();
  // TODO(spike #4): confirm the media id field.
  return String(data.id);
}
