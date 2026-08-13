/**
 * Fixtures for the golden-payload tests (ADR-0015).
 *
 * These are deliberately fixed values: the point of a golden test is that the
 * same input always produces the same bytes, so nothing here may be random,
 * time-dependent, or derived from the environment.
 */

import type { CapturedAd, Photo } from "../../domain/types";

export const CSRF_TOKEN = "csrf-token-aaa";
export const REFRESHED_CSRF_TOKEN = "csrf-token-bbb";

export const FORM_ATTRIBUTES = {
  signature: "sig-abc123",
  timestamp: 1723500000000,
  tmsid: "tms-xyz789",
};

/**
 * The maximal ad: photos in the gallery, bidding on, shipping selected, buyer
 * protection on. Every `createAd` branch is taken. The variants below switch
 * individual branches off; see `marktplaats-api.golden.test.ts`.
 */
export function goldenAd(overrides: Partial<CapturedAd> = {}): CapturedAd {
  return {
    adFeatures: [
      {
        active: true,
        discountPercentage: 0,
        duration: 30,
        effectivePrice: 0,
        featureType: "URGENCY",
        forSale: true,
        includedInSubscription: false,
        maxReplications: 1,
        originalPrice: 599,
        productType: "FEATURE",
        reapplyAfter: 0,
      },
    ],
    adViews: 42,
    attributes: [
      {
        attributeType: "SINGLE_SELECT",
        key: "type",
        label: "Type",
        value: "Herenfiets",
        values: { key: "type", value: "Herenfiets" },
      },
    ],
    buyItNowEnabled: false,
    categoryInformation: {
      categoryId: 1745,
      categoryName: "Fietsen | Herenfietsen",
      parentCategoryId: 1744,
      parentCategoryName: "Fietsen en Brommers",
      verticals: ["bicycles"],
    },
    closeDate: 1726000000000,
    deliveryMethod: "SHIPPING_AND_PICKUP",
    description: "Nette vintage herenfiets, weinig gebruikt.",
    editable: true,
    escrowAllowed: true,
    gallery: {
      imageUrls: [
        "https://images.marktplaats.com/api/v1/listing-mp-p/images/one.jpg",
        "https://images.marktplaats.com/api/v1/listing-mp-p/images/two.jpg",
      ],
    },
    isBuyerProtectionActiveOnListing: true,
    isCarAd: false,
    isMultiLingual: false,
    itemId: "m2100000001",
    phoneUpcallAllowed: false,
    price: {
      biddingEnabled: true,
      priceCent: 12500,
      priceType: "FAST_BID",
    },
    reserved: false,
    shippingInformation: {
      augmentedLabels: [
        {
          carrierId: "DHL",
          labels: [
            {
              carrierName: "DHL",
              deliveryMethod: "SHIPPING",
              label: "Pakket tot 10 kg",
              price: "6.95",
            },
          ],
        },
      ],
      selectedShippingOptions: [
        {
          id: "opt-1",
          carrierId: "DHL",
          carrierName: "DHL",
          code: "DHL_10",
          cost: 695,
          deliveryMethod: "SHIPPING",
          description: "Pakket tot 10 kg",
          discountDetails: { discountType: "NONE", originalCost: 695 },
          label: "DHL pakket",
          mostUsed: true,
          serviceType: "STANDARD",
          termsAndConditionsUrl: "https://www.marktplaats.nl/i/verzenden",
          weightInfo: { max: 10000, min: 0 },
        },
      ],
    },
    shippingServices: [{ code: "DHL_10", priceCent: 695 }],
    showTAMSurvey: false,
    startDate: 1723400000000,
    suspended: false,
    title: "Vintage herenfiets",
    bucketId: 12,
    contactInformation: {
      name: "Jan Jansen",
      postcode: "1011AB",
    },
    ...overrides,
  };
}

export function goldenPhotos(): Photo[] {
  return [
    { filename: "one.jpg", mimeType: "image/jpeg", data: new Uint8Array([1, 2, 3, 4]) },
    { filename: "two.jpg", mimeType: "image/png", data: new Uint8Array([5, 6, 7]) },
  ];
}

/** What `uploadPhoto` gets back for the nth photo. */
export function uploadedPhoto(n: number) {
  return {
    id: `img-${n}`,
    extraLargeImageUrl: `https://images.marktplaats.com/xl/${n}.jpg`,
    imageUrl: `https://images.marktplaats.com/std/${n}.jpg`,
    largeImageUrl: `https://images.marktplaats.com/lg/${n}.jpg`,
    valid: true,
  };
}

// ============================================================================
// HTML pages the layer scrapes
// ============================================================================

/**
 * The CSRF source page. The token lives in a hydration script, which is the
 * path `extractCsrfToken` takes first — see the regex chain in `csrf.ts`.
 */
export function csrfPageHtml(token = CSRF_TOKEN): string {
  return `<!doctype html><html><head><title>Plaats</title></head><body>
<script id="__HYDRATION__">window.__INITIAL_STATE__ = {"session":{"xsrfToken":"${token}"}};</script>
</body></html>`;
}

/** The create-ad page, whose `signature`/`timestamp`/`tmsid` are scraped into the create body. */
export function createAdPageHtml(attrs = FORM_ATTRIBUTES): string {
  const payload = JSON.stringify({ reactData: { form: attrs } });
  return `<!doctype html><html><body>
<script id="__NEXT_DATA__" type="application/json">${payload}</script>
</body></html>`;
}

/** The seller-view page `captureAd` reads the ad out of. */
export function sellerViewHtml(ad: CapturedAd = goldenAd()): string {
  const payload = JSON.stringify({ listing: ad });
  return `<!doctype html><html><body>
<script id="__NEXT_DATA__" type="application/json">${payload}</script>
</body></html>`;
}

/** The `window.__CONFIG__` variant of the seller-view page — the second parser branch. */
export function sellerViewWindowConfigHtml(ad: CapturedAd = goldenAd()): string {
  const payload = JSON.stringify({ listing: ad });
  return `<!doctype html><html><body>
<script>window.__CONFIG__ = ${payload};</script>
</body></html>`;
}
