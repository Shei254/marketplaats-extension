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
import type { ReadyRequest } from "../background/messages";

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
        case "listMyAdsPage": {
            const page = await api.listMyAdsPage(request.batchNumber, request.batchSize);
            return {
                ads: page.ads.map(toListingSummary),
                totalNumberOfResults: page.totalNumberOfResults,
            };
        }
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
        case "reserveAd":
            // Nothing to hand back — the flag is either on the ad or the call
            // threw. Its one caller (T71, #157) swallows either way.
            await api.reserveAd(request.listingId);
            return null;
        case "probeAd":
            return api.probeAd(request.listingId);
        default:
            // Exhaustiveness: adding a RelayRequest kind without handling it here
            // becomes a compile error rather than a silent undefined at runtime.
            throw new Error(`Relay request kind not implemented: ${(request as RelayRequest).kind}`);
    }
}

/**
 * The popup only needs id/title/price per row, and the id it relists with is the
 * ad's itemId — the same id deleteAd/captureAd take.
 *
 * `minimumBidPriceCents` is on the draft and deliberately does not cross (T67): it
 * is the minimum bid *placed*, not the seller's floor, so a row given it would
 * only ever draw it wrong.
 *
 * `reserved` **does** cross, since T71 (#157). It had been on the row all along
 * and was dropped here, which is why nothing on the screen said that an ad the
 * seller had promised to a buyer was about to be deleted and posted again.
 * `?? false` because it is the one field here read from a payload that may
 * predate it — an absent flag is an unreserved ad, and `undefined` on a boolean
 * would draw the badge nowhere and typecheck everywhere.
 */
function toListingSummary(ad: ListingDraft): ListingSummary {
    return {
        id: String(ad.itemId),
        title: ad.title,
        priceCents: ad.priceCents,
        priceType: ad.priceType,
        biddingEnabled: ad.biddingEnabled,
        reserved: ad.reserved ?? false,
    };
}

// This page can now be relayed through, so it is the moment a pending repost can
// be finished (ADR-0039) — and the answer a `Pagina vernieuwen` reload waits for.
// Nobody listening (the worker mid-update) is nothing to report.
const ready: ReadyRequest = { kind: "marktplaats-ready" };
chrome.runtime.sendMessage(ready).catch(() => {});
