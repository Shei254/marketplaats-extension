import * as api from "./marktplaats-api";
import {
    fromWirePhoto,
    toWireError,
    toWirePhoto,
    type RelayRequest,
    type RelayResponse,
    type RelayResult,
} from "./messages";
import type { ListingDraft, ListingSummary } from "../domain/types";

chrome.runtime.onMessage.addListener(
    (request: RelayRequest, _sender, sendResponse: (response: RelayResponse) => void) => {
        handle(request)
            .then((value) => sendResponse({ ok: true, value }))
            .catch((error) => {
                console.error("[ContentScript Relay Error]:", error);
                sendResponse({ ok: false, error: toWireError(error) });
            });
        return true; // Keep channel open for async response
    }
);

async function handle(request: RelayRequest): Promise<RelayResult> {
    switch (request.kind) {
        case "listMyAds":
            return (await api.listMyAds()).map(toListingSummary);
        case "searchAd":
            // The same mapping as listMyAds, because it is the same list: search is
            // a `query` parameter on that path, and a row the popup can relist has
            // to carry the id it relists with (T31, #40).
            return (await api.searchAd(request.query)).map(toListingSummary);
        case "captureAd": {
            const captured = await api.captureAd(request.listingId);
            return { draft: captured.draft, photos: captured.photos.map(toWirePhoto) };
        }
        case "downloadPhoto": {
            const photos = await Promise.all(request.urls.map((url) => api.downloadPhoto(url)));
            return photos.map(toWirePhoto);
        }
        case "deleteAd":
            await api.deleteAd(request.listingId);
            return null;
        case "createAd":
            // No id comes back: Marktplaats answers a create with 200/201/redirect,
            // never JSON. Not throwing is the success signal.
            await api.createAd(request.draft, request.photos.map(fromWirePhoto));
            return null;
        default:
            // Exhaustiveness: adding a RelayRequest kind without handling it here
            // becomes a compile error rather than a silent undefined at runtime.
            throw new Error(`Relay request kind not implemented: ${(request as RelayRequest).kind}`);
    }
}

/**
 * The popup only needs id/title/price per row, and the id it relists with is the
 * ad's itemId — the same id deleteAd/captureAd take.
 */
function toListingSummary(ad: ListingDraft): ListingSummary {
    return { id: String(ad.itemId), title: ad.title, priceCents: ad.priceCents };
}