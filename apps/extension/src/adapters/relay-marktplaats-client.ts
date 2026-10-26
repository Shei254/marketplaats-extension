import type { MarktplaatsClient } from "../domain/marktplaats-client";
import type {AdPresence, AdsPage, CapturedAd, CapturedListing, ListingSummary, Photo} from "../domain/types";
import {
  fromWireError,
  fromWirePhoto,
  toWirePhoto,
  type RelayRequest,
  type RelayResponse,
  type WireCapturedAd,
} from "../content/messages";

/** Raised when no marktplaats.nl tab is open to relay through. */
export class NoMarktplaatsTabError extends Error {
  constructor() {
    super("No marktplaats.nl tab is open");
    this.name = "NoMarktplaatsTabError";
  }
}

/**
 * Every open marktplaats.nl tab is a **Stale tab**: open since before the
 * extension was installed, updated or re-enabled, so no content script runs in
 * it until it is reloaded (ADR-0039). `tabId` is the one the popup offers to
 * reload.
 */
export class StaleMarktplaatsTabError extends Error {
  constructor(public readonly tabId: number) {
    super("The marktplaats.nl tab has to be reloaded");
    this.name = "StaleMarktplaatsTabError";
  }
}

// In the domain since ADR-0039, which reads its status; re-exported so the
// relay's callers keep one import for the errors it raises.
export { ApiRequestError } from "../domain/marktplaats-client";

/**
 * MarktplaatsClient used by the popup/background. It doesn't call Marktplaats
 * directly; it relays each request to the content script running in a
 * marktplaats.nl tab (which has the session + CSRF context). Errors are
 * reconstructed on this side so the orchestrator's typed-error contract holds.
 */
export class RelayMarktplaatsClient implements MarktplaatsClient {
  async listMyAds(): Promise<ListingSummary[]> {
    return this.send<ListingSummary[]>({kind: "listMyAds"});
  }

  async listMyAdsPage(batchNumber?: number, batchSize?: number): Promise<AdsPage> {
    // `undefined` fields are dropped by the JSON message boundary, so page 1
    // (no arguments) reaches the API with no query string at all.
    return this.send<AdsPage>({ kind: "listMyAdsPage", batchNumber, batchSize });
  }

  async captureAd(listingId: string): Promise<CapturedListing> {
    const wire = await this.send<WireCapturedAd>({kind: "captureAd", listingId});
    return {draft: wire.draft, photos: wire.photos.map(fromWirePhoto)};
  }

  async deleteAd(listingId: string): Promise<void> {
    await this.send<null>({kind: "deleteAd", listingId});
  }

  async createAd(draft: CapturedAd, photos: Photo[]): Promise<void> {
    await this.send<null>({
      kind: "createAd",
      draft,
      photos: photos.map(toWirePhoto),
    });
  }

  async reserveAd(listingId: string): Promise<void> {
    await this.send<null>({ kind: "reserveAd", listingId });
  }

  searchAd(query: string): Promise<ListingSummary[]> {
    return this.send({
      kind: "searchAd",
      query
    });
  }

  probeAd(listingId: string): Promise<AdPresence> {
    return this.send({ kind: "probeAd", listingId })
  }

  /**
   * Through the first marktplaats.nl tab whose content script answers. Only
   * Chrome's "no receiver" moves on to the next tab: a request that reached a
   * content script has been acted on, and a failed delete or create sent again
   * from a second tab may run twice.
   */
  private async send<T>(request: RelayRequest): Promise<T> {
    const tabIds = await marktplaatsTabs();
    if (tabIds.length === 0) throw new NoMarktplaatsTabError();

    for (const tabId of tabIds) {
      let response: RelayResponse;
      try {
        response = (await chrome.tabs.sendMessage(tabId, request)) as RelayResponse;
      } catch (error) {
        if (isNoReceiver(error)) continue;
        throw error;
      }
      if (!response.ok) throw fromWireError(response.error);
      return response.value as T;
    }
    throw new StaleMarktplaatsTabError(tabIds[0]!);
  }
}

async function marktplaatsTabs(): Promise<number[]> {
  const tabs = await chrome.tabs.query({ url: "https://www.marktplaats.nl/*" });
  return tabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id]));
}

/** Chrome's words for a tab with no content script to answer — it has no error codes. */
function isNoReceiver(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Receiving end does not exist");
}
