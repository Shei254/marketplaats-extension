import * as api from "./marktplaats-api";
import {
    fromWirePhoto,
    toWireError,
    toWirePhoto,
    type RelayRequest,
    type RelayResponse,
    type WirePhoto,
} from "./messages";
import type { CapturedAd, ListingDraft, ListingSummary } from "../domain/types";

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

async function handle(
    request: RelayRequest
): Promise<ListingSummary[] | { draft: CapturedAd; photos: WirePhoto[] } | WirePhoto[] | null> {
    switch (request.kind) {
        case "listMyAds":
            return (await api.listMyAds()).map(toListingSummary);
        case "captureAd": {
            const captured = await api.captureAd(request.listingId);
            return { draft: captured.draft, photos: captured.photos.map(toWirePhoto) };
        }
        case "downloadPhoto": {
            const photos = await Promise.all(request.photoUrls.map((url) => api.downloadPhoto(url)));
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
        case "searchAd":
            console.log("SearchAd request", request);
            await api.searchAd(request.query);
            return
        default:
            console.error("Request kind not implemented", request.kind)
    }
}

/**
 * The popup only needs id/title/price per row, and the id it relists with is the
 * ad's itemId — the same id deleteAd/captureAd take.
 */
function toListingSummary(ad: ListingDraft): ListingSummary {
    return { id: String(ad.itemId), title: ad.title, priceCents: ad.priceCents };
}