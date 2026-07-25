import * as api from "./marktplaats-api";
import {
  fromWirePhoto,
  toWireError,
  toWirePhoto,
  type RelayRequest,
  type RelayResponse,
  type RelayResult,
} from "./messages";

/**
 * Content script injected into marktplaats.nl. It runs in the page's origin, so
 * its fetches carry the user's session and it can read the page's CSRF token.
 * It executes RelayRequests from the popup/background and returns RelayResponses.
 */
chrome.runtime.onMessage.addListener(
  (request: RelayRequest, _sender, sendResponse: (response: RelayResponse) => void) => {
    handle(request)
      .then((value) => sendResponse({ ok: true, value }))
      .catch((error) => sendResponse({ ok: false, error: toWireError(error) }));
    return true; // keep the message channel open for the async response
  },
);

async function handle(request: RelayRequest): Promise<RelayResult> {
  switch (request.kind) {
    case "listMyAds":
      return api.listMyAds();
    case "captureAd": {
      const captured = await api.captureAd(request.listingId);
      return { draft: captured.draft, photos: captured.photos.map(toWirePhoto) };
    }
    case "deleteAd":
      await api.deleteAd(request.listingId);
      return null;
    case "createAd":
      return api.createAd(request.draft, request.photos.map(fromWirePhoto));
  }
}
