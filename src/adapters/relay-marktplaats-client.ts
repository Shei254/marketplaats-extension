import type { MarktplaatsClient } from "../domain/marktplaats-client";
import type { CapturedAd, ListingDraft, ListingSummary, Photo } from "../domain/types";
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
 * MarktplaatsClient used by the popup/background. It doesn't call Marktplaats
 * directly; it relays each request to the content script running in a
 * marktplaats.nl tab (which has the session + CSRF context). Errors are
 * reconstructed on this side so the orchestrator's typed-error contract holds.
 */
export class RelayMarktplaatsClient implements MarktplaatsClient {
  async listMyAds(): Promise<ListingSummary[]> {
    return this.send<ListingSummary[]>({ kind: "listMyAds" });
  }

  async captureAd(listingId: string): Promise<CapturedAd> {
    const wire = await this.send<WireCapturedAd>({ kind: "captureAd", listingId });
    return { draft: wire.draft, photos: wire.photos.map(fromWirePhoto) };
  }

  async deleteAd(listingId: string): Promise<void> {
    await this.send<null>({ kind: "deleteAd", listingId });
  }

  async createAd(draft: ListingDraft, photos: Photo[]): Promise<{ id: string }> {
    return this.send<{ id: string }>({
      kind: "createAd",
      draft,
      photos: photos.map(toWirePhoto),
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
