import type { CapturedAd, CapturedListing, ListingDraft, ListingSummary, Photo } from "./types";

/** Raised when Marktplaats is not logged in — the popup shows a "log in first" state. */
export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated with Marktplaats");
    this.name = "NotAuthenticatedError";
  }
}

/** Raised when an ad is already gone. Treated by the orchestrator as "already deleted". */
export class AdNotFoundError extends Error {
  constructor(public readonly listingId: string) {
    super(`Ad ${listingId} not found`);
    this.name = "AdNotFoundError";
  }
}

/**
 * Raised when a Marktplaats endpoint (or the CSRF token source) has not yet been
 * wired from the spike findings (issues #3/#4). Surfaced in the popup as a
 * "not wired up yet" state so the POC runs end-to-end with clear gaps.
 */
export class SpikePendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpikePendingError";
  }
}

/**
 * System boundary (ADR-0004): the extension's access to Marktplaats via its own
 * internal API, riding the user's session. The real implementation is a spike gate
 * (issue #3); the orchestrator is tested against a fake of this interface.
 */
export interface MarktplaatsClient {
  /** The user's own ads. Throws NotAuthenticatedError if not logged in. */
  listMyAds(): Promise<ListingSummary[]>;
  /** The user's own ads matching a query, filtered by Marktplaats, not locally. */
  searchAd(query: string): Promise<ListingDraft[]>;
  /** Capture everything needed to re-create an ad (fields + full-res photos). */
  captureAd(listingId: string): Promise<CapturedListing>;
  /** Delete an ad. Throws AdNotFoundError if it is already gone. */
  deleteAd(listingId: string): Promise<void>;
  /**
   * Create a fresh ad from a captured ad + photos. Marktplaats answers a create
   * with a 200/201/redirect and no JSON body, so there is no new listing id to
   * hand back: resolving at all is the success signal, and a failure throws.
   */
  createAd(draft: CapturedAd, photos: Photo[]): Promise<void>;
}
