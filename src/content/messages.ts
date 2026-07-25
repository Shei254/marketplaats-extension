import {
  AdNotFoundError,
  NotAuthenticatedError,
  SpikePendingError,
} from "../domain/marktplaats-client";
import type { ListingDraft, ListingSummary, Photo } from "../domain/types";
import { base64ToBytes, bytesToBase64 } from "../shared/base64";

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
  draft: ListingDraft;
  photos: WirePhoto[];
}

export type RelayRequest =
  | { kind: "listMyAds" }
  | { kind: "captureAd"; listingId: string }
  | { kind: "deleteAd"; listingId: string }
  | { kind: "createAd"; draft: ListingDraft; photos: WirePhoto[] };

export type RelayResult = ListingSummary[] | WireCapturedAd | null | { id: string };

export type WireErrorCode =
  | "AD_NOT_FOUND"
  | "NOT_AUTHENTICATED"
  | "SPIKE_PENDING"
  | "UNKNOWN";

export interface WireError {
  code: WireErrorCode;
  message: string;
  listingId?: string;
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
    case "AD_NOT_FOUND":
      return new AdNotFoundError(error.listingId ?? "");
    case "NOT_AUTHENTICATED":
      return new NotAuthenticatedError();
    case "SPIKE_PENDING":
      return new SpikePendingError(error.message);
    case "UNKNOWN":
      return new Error(error.message);
  }
}
