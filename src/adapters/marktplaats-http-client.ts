import type { MarktplaatsClient } from "../domain/marktplaats-client";
import type { CapturedAd, ListingDraft, ListingSummary, Photo } from "../domain/types";

/**
 * Real MarktplaatsClient over Marktplaats's internal API, riding the user's session
 * cookies (ADR-0004).
 *
 * DELIBERATELY UNIMPLEMENTED. The concrete endpoints, request shapes, and the
 * CSRF/session token handling are unknown until the spikes resolve:
 *   - issue #3: write path — delete + create + CSRF/session token
 *   - issue #4: photo capture + re-upload
 * The read path (listMyAds) is issue #2. These methods throw until those spikes
 * land real endpoints, rather than guessing an API that may not exist.
 */
export class MarktplaatsHttpClient implements MarktplaatsClient {
  listMyAds(): Promise<ListingSummary[]> {
    throw new SpikePendingError("listMyAds", "#2");
  }

  captureAd(_listingId: string): Promise<CapturedAd> {
    throw new SpikePendingError("captureAd", "#4");
  }

  deleteAd(_listingId: string): Promise<void> {
    throw new SpikePendingError("deleteAd", "#3");
  }

  createAd(_draft: ListingDraft, _photos: Photo[]): Promise<{ id: string }> {
    throw new SpikePendingError("createAd", "#3");
  }
}

export class SpikePendingError extends Error {
  constructor(operation: string, issue: string) {
    super(`MarktplaatsHttpClient.${operation} is pending spike ${issue}`);
    this.name = "SpikePendingError";
  }
}
