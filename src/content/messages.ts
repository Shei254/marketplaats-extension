import {
  AdNotFoundError,
  NotAuthenticatedError,
  SpikePendingError,
} from "../domain/marktplaats-client";
import type { CapturedAd, ListingDraft, ListingSummary, Photo } from "../domain/types";
import { base64ToBytes, bytesToBase64 } from "../shared/base64";
import {ApiRequestError, NoMarktplaatsTabError} from "../adapters/relay-marktplaats-client";

/**
 * Wire protocol for the content-script relay. The popup/background send a
 * RelayRequest to the marktplaats.nl content script (which has the session +
 * CSRF context) and get back a RelayResponse. Photos cross the boundary as
 * base64 because chrome.runtime messaging is JSON-serialised.
 */

export interface WirePhoto {
  filename: string;
  mimeType: string;
  base64: string;
}

export interface WireCapturedAd {
  draft: CapturedAd;
  photos: WirePhoto[];
}

export type RelayRequest =
  | { kind: "listMyAds" }
  | { kind: "getBuckets"; }
  | { kind: "getBucketCategories"}
  | { kind: "captureAd"; listingId: string }
  | { kind: "deleteAd"; listingId: string }
  | { kind: "createAd"; draft: CapturedAd; photos: WirePhoto[] }
  | { kind: "downloadPhoto"; urls: string[] }
  | { kind: "searchAd"; query: string }


export type RelayResult =
  | ListingSummary[]
  | ListingDraft[]
  | WireCapturedAd
  | WirePhoto[]
  | null;

export type WireErrorCode =
  | "AD_NOT_FOUND"
  | "NOT_AUTHENTICATED"
  | "NO_MARKTPLAATS_TAB"
  | "SPIKE_PENDING"
  | "API_ERROR"
  | "UNKNOWN";

export interface WireError {
  code: WireErrorCode;
  message: string;
  listingId?: string;
  status?: number; // Add these fields
  body?: string;
}

export type RelayResponse =
  | { ok: true; value: RelayResult }
  | { ok: false; error: WireError };

export function toWirePhoto(photo: Photo): WirePhoto {
  return { filename: photo.filename, mimeType: photo.mimeType, base64: bytesToBase64(photo.data) };
}

export function fromWirePhoto(wire: WirePhoto): Photo {
  return { filename: wire.filename, mimeType: wire.mimeType, data: base64ToBytes(wire.base64) };
}

/** Map a thrown error to a serialisable wire error (content-script side). */
export function toWireError(error: unknown): WireError {
  if (error instanceof AdNotFoundError) {
    return { code: "AD_NOT_FOUND", message: error.message, listingId: error.listingId };
  }
  if (error instanceof NotAuthenticatedError) {
    return { code: "NOT_AUTHENTICATED", message: error.message };
  }

  if (error instanceof NoMarktplaatsTabError) {
    return { code: "NO_MARKTPLAATS_TAB", message: error.message };
  }

  if (error instanceof ApiRequestError) {
    return {
      code: "API_ERROR",
      message: error.message,
      status: error.status,
      body: error.body,
    };
  }

  if (error instanceof SpikePendingError) {
    return { code: "SPIKE_PENDING", message: error.message };
  }
  return { code: "UNKNOWN", message: error instanceof Error ? error.message : String(error) };
}

/**
 * Reconstruct the typed error on the caller side. Crucially this restores
 * AdNotFoundError so the orchestrator's `instanceof AdNotFoundError` contract
 * survives the message boundary.
 */
export function fromWireError(error: WireError): Error {
  switch (error.code) {
    case "API_ERROR":
      return new ApiRequestError("unknown", error.status ?? 0, error.body ?? "");
    case "AD_NOT_FOUND":
      return new AdNotFoundError(error.listingId ?? "");
    case "NOT_AUTHENTICATED":
      return new NotAuthenticatedError();
    case "NO_MARKTPLAATS_TAB":
      return new NoMarktplaatsTabError();
    case "SPIKE_PENDING":
      return new SpikePendingError(error.message);
    case "UNKNOWN":
      return new Error(error.message);
  }
}
