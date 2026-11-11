import type {AdPresence, AdsPage, CapturedAd, CapturedListing, ListingSummary, Photo} from "./types";

/**
 * The captured ad cannot be turned into a create form at all: a field the form
 * needs is missing or malformed. Sending the same draft again meets the same
 * hole, so the orchestrator treats this as "waits for the user" and does not
 * retry it on a schedule. `reason` is for the console; the popup says a fixed
 * sentence instead.
 */
export class DraftUnusableError extends Error {
  constructor(public readonly reason: string) {
    super(`Draft cannot be turned into a create form: ${reason}`);
    this.name = "DraftUnusableError";
  }
}

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
 * A create whose redirect chain did not end where a placed ad's does — on
 * `/seller/view/<id>?previousAction=syiSuccess` (observed 2026-11-11, ADR-0041).
 * So it is **not a Confirmed create**, and nothing may be deleted on its account.
 *
 * `paymentRequired` is the chain stopping on a `/payments/` page: Marktplaats wants
 * money to place this ad, and we never pay on a seller's behalf, so the ad cannot
 * be reposted. Anything else is a chain we do not recognise. `endedOn` is for the
 * console.
 */
export class CreateNotConfirmedError extends Error {
  constructor(public readonly endedOn: string) {
    super(`The create did not end on a placed ad: ${endedOn}`);
    this.name = "CreateNotConfirmedError";
  }

  get paymentRequired(): boolean {
    try {
      return new URL(this.endedOn, "https://www.marktplaats.nl").pathname.startsWith("/payments/");
    } catch {
      return false;
    }
  }
}

/**
 * Marktplaats answered a request with a status we do not map to anything else.
 * The status is kept because the resume reads it: a capture answering `410` is
 * an ad that has been deleted (ADR-0039, observed 2026-09-27).
 */
export class ApiRequestError extends Error {
  constructor(
      public endpoint: string,
      public status: number,
      public body: string
  ) {
    super(`API Error [${endpoint}]: HTTP ${status} - ${body.substring(0, 200)}...`);
    this.name = "ApiRequestError";
  }
}

/**
 * System boundary (ADR-0004): the extension's access to Marktplaats via its own
 * internal API, riding the user's session. The real implementation is a spike gate
 * (issue #3); the orchestrator is tested against a fake of this interface.
 */
export interface MarktplaatsClient {
  /** The user's own ads. Throws NotAuthenticatedError if not logged in. */
  listMyAds(batchNumber?: number, batchSize?: number): Promise<ListingSummary[]>;

  listMyAdsPage(batchNumber?: number, batchSize?: number): Promise<AdsPage>;

  probeAd (listingId: string): Promise<AdPresence>
  /**
   * The user's own ads matching a query, filtered by Marktplaats and not here.
   *
   * The same rows `listMyAds` answers with, because they are the same rows: one
   * path, one shape, a `query` parameter (`docs/internal-api-findings.md`). A
   * search result is relisted by the button beside it (T31, #40), so it has to
   * carry the id that button relists with — which is what returning a summary
   * rather than a draft is for.
   */
  searchAd(query: string): Promise<ListingSummary[]>;
  /** Capture everything needed to re-create an ad (fields + full-res photos). */
  captureAd(listingId: string): Promise<CapturedListing>;
  /** Delete an ad. Throws AdNotFoundError if it is already gone. */
  deleteAd(listingId: string): Promise<void>;
  /**
   * Create a fresh ad from a captured ad + photos, and answer with **the new ad's
   * id** — a Confirmed create (ADR-0041). Marktplaats answers with server redirects
   * ending on `/seller/view/<id>?previousAction=syiSuccess`, and the id is read off
   * that. A chain that ends anywhere else throws `CreateNotConfirmedError`; a
   * request that fails outright throws whatever failed, and may still have landed.
   */
  createAd(draft: CapturedAd, photos: Photo[]): Promise<string>;
  /**
   * Mark an ad as **Gereserveerd** — promised to a buyer (T71, #157).
   *
   * Only ever *set*, never cleared: a freshly created ad is never reserved, so
   * whether Marktplaats's endpoint is a toggle or a setter is a question nothing
   * here has to answer. Takes the id of the ad to flag, which for the one caller
   * is the **new** ad a repost just created rather than the one it deleted.
   */
  reserveAd(listingId: string): Promise<void>;
}
