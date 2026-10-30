import {
    AdNotFoundError, DraftUnusableError, NotAuthenticatedError, SpikePendingError,
} from "../domain/marktplaats-client";
import type {AdsPage, CapturedAd, ListingSummary, Photo} from "../domain/types";
import {base64ToBytes, bytesToBase64} from "../shared/base64";
import {ApiRequestError, NoMarktplaatsTabError, StaleMarktplaatsTabError} from "../adapters/relay-marktplaats-client";
import {SignInCancelledError, SignInFailedError} from "../auth/errors";

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

export type RelayRequest = | { kind: "listMyAds" } | { kind: "getBuckets"; } | { kind: "getBucketCategories" } | {
    kind: "captureAd";
    listingId: string
} | { kind: "deleteAd"; listingId: string } | { kind: "createAd"; draft: CapturedAd; photos: WirePhoto[] } | {
    kind: "reserveAd";
    listingId: string
} | { kind: "downloadPhoto"; urls: string[] } | { kind: "searchAd"; query: string } | {
    kind: "listMyAdsPage";
    batchNumber?: number;
    batchSize?: number
} | { kind: "probeAd"; listingId: string }


export type RelayResult =
    | ListingSummary[]
    | WireCapturedAd
    | AdsPage
    | WirePhoto[]
    | null
    | "exists"
    | "gone"
    | "unknown"

export type WireErrorCode =
    | "AD_NOT_FOUND"
    | "DRAFT_UNUSABLE"
    | "SIGN_IN_CANCELLED"
    | "SIGN_IN_FAILED"
    | "NOT_AUTHENTICATED"
    | "NO_MARKTPLAATS_TAB"
    | "STALE_MARKTPLAATS_TAB"
    | "SPIKE_PENDING"
    | "API_ERROR"
    | "TIMEOUT"
    | "NETWORK"
    | "UNKNOWN";

export interface WireError {
    code: WireErrorCode;
    message: string;
    listingId?: string;
    status?: number; // Add these fields
    body?: string;
    /** The tab to reload, on `STALE_MARKTPLAATS_TAB`. */
    tabId?: number;
}

export type RelayResponse = | { ok: true; value: RelayResult } | { ok: false; error: WireError };

export function toWirePhoto(photo: Photo): WirePhoto {
    return {filename: photo.filename, mimeType: photo.mimeType, base64: bytesToBase64(photo.data)};
}

export function fromWirePhoto(wire: WirePhoto): Photo {
    return {filename: wire.filename, mimeType: wire.mimeType, data: base64ToBytes(wire.base64)};
}

/** Map a thrown error to a serialisable wire error (content-script side). */
export function toWireError(error: unknown): WireError {
    if (error instanceof AdNotFoundError) {
        return {code: "AD_NOT_FOUND", message: error.message, listingId: error.listingId};
    }
    if (error instanceof NotAuthenticatedError) {
        return {code: "NOT_AUTHENTICATED", message: error.message};
    }

    if (error instanceof NoMarktplaatsTabError) {
        return {code: "NO_MARKTPLAATS_TAB", message: error.message};
    }

    if (error instanceof StaleMarktplaatsTabError) {
        return {code: "STALE_MARKTPLAATS_TAB", message: error.message, tabId: error.tabId};
    }

    if (error instanceof ApiRequestError) {
        return {
            code: "API_ERROR", message: error.message, status: error.status, body: error.body,
        };
    }

    if (error instanceof SpikePendingError) {
        return {code: "SPIKE_PENDING", message: error.message};
    }

    if (error instanceof DraftUnusableError) {
        return {code: "DRAFT_UNUSABLE", message: error.message};
    }

    // The two halves of a sign-in that produced no session are different events —
    // a closed window is not a failure to report — and that distinction is only
    // useful if it survives the message boundary, exactly as AdNotFoundError's does.
    if (error instanceof SignInCancelledError) {
        return {code: "SIGN_IN_CANCELLED", message: error.message};
    }

    if (error instanceof SignInFailedError) {
        return {code: "SIGN_IN_FAILED", message: error.message};
    }

    const name = (error as { name?: string } | null)?.name
    if (name == "TimeoutError" || name == "AbortError") {
        return { code: "TIMEOUT", message: String((error as Error).message) }
    }
    if (error instanceof TypeError && /failed to fetch|network/i.test(error.message)) {
        return { code: "NETWORK", message: error.message }
    }

    return {code: "UNKNOWN", message: error instanceof Error ? error.message : String(error)};
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
        case "STALE_MARKTPLAATS_TAB":
            return new StaleMarktplaatsTabError(error.tabId ?? -1);
        case "SPIKE_PENDING":
            return new SpikePendingError(error.message);
        case "SIGN_IN_CANCELLED":
            return new SignInCancelledError(error.message);
        case "SIGN_IN_FAILED":
            return new SignInFailedError(error.message);
        case "DRAFT_UNUSABLE":
            return new DraftUnusableError(error.message);
        case "TIMEOUT":
            return named("TimeoutError", error.message)
        default:
            return new Error("Something went wrong. Please try again");
    }
}

function named (name: string, message: string): Error {
    const e = new Error(message);
    e.name = name
    return e
}