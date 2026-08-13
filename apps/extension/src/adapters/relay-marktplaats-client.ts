import type { MarktplaatsClient } from "../domain/marktplaats-client";
import type { CapturedAd, CapturedListing, ListingDraft, ListingSummary, Photo } from "../domain/types";
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
 * MarktplaatsClient used by the popup/background. It doesn't call Marktplaats
 * directly; it relays each request to the content script running in a
 * marktplaats.nl tab (which has the session + CSRF context). Errors are
 * reconstructed on this side so the orchestrator's typed-error contract holds.
 */
export class RelayMarktplaatsClient implements MarktplaatsClient {
  async listMyAds(): Promise<ListingSummary[]> {
    return this.send<ListingSummary[]>({kind: "listMyAds"});
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

  searchAd(query: string): Promise<ListingDraft[]> {
    return this.send({
      kind: "searchAd",
      query
    });
  }

  private async send<T>(request: RelayRequest): Promise<T> {
    const tabId = await findMarktplaatsTab();
    const response = (await chrome.tabs.sendMessage(tabId, request)) as RelayResponse;
    if (!response.ok) throw fromWireError(response.error);
    return response.value as T;
  }

}

async function findMarktplaatsTab(): Promise<number> {
  const tabs = await chrome.tabs.query({ url: "https://www.marktplaats.nl/*" });
  const tabId = tabs.find((tab) => tab.id !== undefined)?.id;
  if (tabId === undefined) throw new NoMarktplaatsTabError();
  return tabId;
}
