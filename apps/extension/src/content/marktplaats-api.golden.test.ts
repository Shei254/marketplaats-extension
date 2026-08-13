/**
 * Golden-payload characterization tests for the Marktplaats internal-API layer.
 *
 * READ ADR-0015 BEFORE CHANGING AN EXPECTATION HERE.
 *
 * These tests are deliberately over-specified: they assert method, URL, every
 * header, and the request body byte-for-byte including form field order. They
 * exist so that moving this code, deduplicating its config, or refactoring
 * `createAd` cannot silently change a single emitted byte. A cosmetic-looking
 * failure is the mechanism working, not a brittle test.
 *
 * A golden test proves we did not change what we send. It cannot prove that what
 * we send still works — only that a regression is ours rather than Marktplaats's.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeStub } from "../testing/chrome-stub";
import {
  encodePairs,
  installDom,
  stubFetch,
  type FetchStub,
  type RecordedRequest,
  type Route,
} from "./testing/golden-harness";
import {
  CSRF_TOKEN,
  REFRESHED_CSRF_TOKEN,
  createAdPageHtml,
  csrfPageHtml,
  goldenAd,
  goldenPhotos,
  sellerViewHtml,
  sellerViewWindowConfigHtml,
  uploadedPhoto,
} from "./testing/fixtures";
type Api = typeof import("./marktplaats-api");
type Errors = typeof import("../domain/marktplaats-client");

let api: Api;
let errors: Errors;
let http: FetchStub;
let uninstallDom: () => void;

/**
 * `vi.resetModules()` clears the module-scope caches (`cachedConfig`,
 * `cachedCsrfToken`, `activeRefreshPromise`) that would otherwise leak between
 * tests. The error classes are re-imported alongside so `instanceof` compares
 * against the same fresh module graph the API module is using.
 */
beforeEach(async () => {
  vi.resetModules();
  uninstallDom = installDom();
  installChromeStub();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  errors = await import("../domain/marktplaats-client");
  api = await import("./marktplaats-api");
});

afterEach(() => {
  http?.restore();
  uninstallDom?.();
  vi.restoreAllMocks();
});

const CSRF_PAGE: Route = { method: "GET", url: "/plaats/1/2", reply: { html: csrfPageHtml() } };
const CREATE_AD_PAGE: Route = {
  method: "GET",
  url: "/plaats/1744/1745",
  reply: { html: createAdPageHtml() },
};
const UPLOAD: Route = {
  method: "POST",
  url: "/plaats/api/image/upload",
  reply: [{ json: uploadedPhoto(1) }, { json: uploadedPhoto(2) }],
};
const CREATE: Route = { method: "POST", url: "/plaats/ads", reply: { status: 200, text: "" } };

function routes(...extra: Route[]): Route[] {
  return [...extra, CSRF_PAGE, CREATE_AD_PAGE, UPLOAD, CREATE];
}

/** Every request carries the session cookie; nothing in this layer is anonymous. */
function expectSessionRequest(req: RecordedRequest, method: string, url: string) {
  expect(req.method).toBe(method);
  expect(req.url).toBe(url);
  expect(req.credentials).toBe("include");
}

function urlencoded(req: RecordedRequest) {
  if (req.body.kind !== "urlencoded") {
    throw new Error(`expected a urlencoded body, got '${req.body.kind}'`);
  }
  return req.body;
}

// ============================================================================
// Read operations
// ============================================================================

describe("listMyAds", () => {
  it("emits a bare credentialed GET with no headers of its own", async () => {
    http = stubFetch(
      routes({
        method: "GET",
        url: "/my-account/sell/api/listings",
        reply: { json: { ads: [{ itemId: "m1" }] } },
      }),
    );

    const ads = await api.listMyAds();

    expect(http.calls).toHaveLength(1);
    const req = http.only("/my-account/sell/api/listings");
    expectSessionRequest(req, "GET", "/my-account/sell/api/listings");
    expect(req.headers).toEqual({});
    expect(req.body).toEqual({ kind: "none" });
    expect(ads).toEqual([{ itemId: "m1" }]);
  });

  it("returns an empty list when the payload carries no ads", async () => {
    http = stubFetch(routes({ method: "GET", url: "/listings", reply: { json: {} } }));
    expect(await api.listMyAds()).toEqual([]);
  });
});

describe("searchAd", () => {
  it("appends the query as a urlencoded search param on the listings path", async () => {
    http = stubFetch(routes({ method: "GET", url: "/listings", reply: { json: { ads: [] } } }));

    await api.searchAd("vintage fiets");

    const req = http.only("/listings");
    expectSessionRequest(req, "GET", "/my-account/sell/api/listings?query=vintage+fiets");
    expect(req.headers).toEqual({});
    expect(req.body).toEqual({ kind: "none" });
  });
});

describe("getBuckets", () => {
  it("substitutes the parent category into the aggregate path", async () => {
    http = stubFetch(
      routes({ method: "GET", url: /\/buckets$/, reply: { json: [{ id: 12, name: "Fietsen" }] } }),
    );

    const buckets = await api.getBuckets(1744);

    const req = http.only("/buckets");
    expectSessionRequest(req, "GET", "/plaats/api/v1/category-aggregate/1744/buckets");
    expect(req.headers).toEqual({});
    expect(req.body).toEqual({ kind: "none" });
    expect(buckets).toEqual([{ id: 12, name: "Fietsen" }]);
  });
});

describe("captureAd", () => {
  const AD_ID = "m2100000001";

  function captureRoutes(pageHtml: string): Route[] {
    return routes(
      { method: "GET", url: `/seller/view/${AD_ID}`, reply: { html: pageHtml } },
      {
        method: "GET",
        url: /\/buckets\/\d+\/categories$/,
        reply: { json: [{ id: 1745, name: "Herenfietsen", parentId: 1744, readOnly: false, shortName: "heren" }] },
      },
      { method: "GET", url: /\/buckets$/, reply: { json: [{ id: 12, name: "Fietsen" }] } },
      {
        method: "GET",
        url: "images.marktplaats.com",
        reply: { bytes: new Uint8Array([9, 9]), headers: { "content-type": "image/jpeg" } },
      },
    );
  }

  it("scrapes the seller-view page, downloads the gallery, and resolves the bucket", async () => {
    http = stubFetch(captureRoutes(sellerViewHtml()));

    const { draft, photos } = await api.captureAd(AD_ID);

    const page = http.only(`/seller/view/${AD_ID}`);
    expectSessionRequest(page, "GET", `/seller/view/${AD_ID}`);
    expect(page.headers).toEqual({});
    expect(page.body).toEqual({ kind: "none" });

    // Photos are fetched directly, not through request() — same credentials, no CSRF.
    const images = http.matching("images.marktplaats.com");
    expect(images.map((r) => r.url)).toEqual([
      "https://images.marktplaats.com/api/v1/listing-mp-p/images/one.jpg",
      "https://images.marktplaats.com/api/v1/listing-mp-p/images/two.jpg",
    ]);
    for (const img of images) {
      expect(img.method).toBe("GET");
      expect(img.credentials).toBe("include");
    }
    expect(photos).toEqual([
      { filename: "one.jpg", mimeType: "image/jpeg", data: new Uint8Array([9, 9]) },
      { filename: "two.jpg", mimeType: "image/jpeg", data: new Uint8Array([9, 9]) },
    ]);

    // Category → bucket mapping is an N-request fan-out, one per bucket.
    const categories = http.only("/buckets/12/categories");
    expectSessionRequest(
      categories,
      "GET",
      "/plaats/api/v1/category-aggregate/1744/buckets/12/categories",
    );
    expect(categories.headers).toEqual({});
    expect(categories.body).toEqual({ kind: "none" });
    expect(draft.bucketId).toBe(12);
    expect(draft.title).toBe("Vintage herenfiets");
  });

  it("falls back to the window.__CONFIG__ parser when there is no __NEXT_DATA__", async () => {
    http = stubFetch(captureRoutes(sellerViewWindowConfigHtml()));

    const { draft } = await api.captureAd(AD_ID);

    expect(draft.itemId).toBe(AD_ID);
    expect(draft.bucketId).toBe(12);
  });

  it("raises AdNotFoundError when neither hydration payload is present", async () => {
    http = stubFetch(captureRoutes("<!doctype html><html><body>nothing here</body></html>"));
    await expect(api.captureAd(AD_ID)).rejects.toThrow(errors.AdNotFoundError);
  });

  it("raises SpikePendingError rather than a TypeError when no bucket matches the category", async () => {
    http = stubFetch(
      routes(
        { method: "GET", url: `/seller/view/${AD_ID}`, reply: { html: sellerViewHtml() } },
        // No bucket contains category 1745.
        { method: "GET", url: /\/buckets\/\d+\/categories$/, reply: { json: [{ id: 999 }] } },
        { method: "GET", url: /\/buckets$/, reply: { json: [{ id: 12, name: "Fietsen" }] } },
        {
          method: "GET",
          url: "images.marktplaats.com",
          reply: { bytes: new Uint8Array([9]), headers: { "content-type": "image/jpeg" } },
        },
      ),
    );

    await expect(api.captureAd(AD_ID)).rejects.toThrow("Could not resolve a mapped bucket");
  });
});

// ============================================================================
// Write operations
// ============================================================================

describe("deleteAd", () => {
  it("emits a JSON DELETE carrying the CSRF header and a fixed reason", async () => {
    http = stubFetch(routes({ method: "DELETE", url: "/seller/api/delete-ad", reply: { status: 200, text: "" } }));

    await api.deleteAd("m2100000001");

    const req = http.only("/seller/api/delete-ad");
    expectSessionRequest(req, "DELETE", "/seller/api/delete-ad");
    expect(req.headers).toEqual({
      "content-type": "application/json",
      "x-mp-xsrf": CSRF_TOKEN,
    });
    expect(req.body).toEqual({
      kind: "text",
      raw: '{"itemId":"m2100000001","reason":"NO_DEAL_VIA_MP"}',
    });
  });

  it("maps a 404 to AdNotFoundError", async () => {
    http = stubFetch(routes({ method: "DELETE", url: "/seller/api/delete-ad", reply: { status: 404, text: "" } }));
    await expect(api.deleteAd("m2100000001")).rejects.toThrow(errors.AdNotFoundError);
  });
});

describe("uploadPhoto (via createAd)", () => {
  it("posts multipart form-data with the name field before the image blob", async () => {
    http = stubFetch(routes());

    await api.createAd(goldenAd(), goldenPhotos());

    const uploads = http.matching("/plaats/api/image/upload");
    expect(uploads).toHaveLength(2);

    expectSessionRequest(uploads[0]!, "POST", "/plaats/api/image/upload");
    // No content-type of our own: the boundary is the runtime's to choose.
    expect(uploads[0]!.headers).toEqual({ "x-mp-xsrf": CSRF_TOKEN });
    expect(uploads[0]!.body).toEqual({
      kind: "formdata",
      parts: [
        { name: "name", value: "one.jpg" },
        { name: "imageData", filename: "one.jpg", mimeType: "image/jpeg", bytes: [1, 2, 3, 4] },
      ],
    });

    expect(uploads[1]!.body).toEqual({
      kind: "formdata",
      parts: [
        { name: "name", value: "two.jpg" },
        { name: "imageData", filename: "two.jpg", mimeType: "image/png", bytes: [5, 6, 7] },
      ],
    });
  });
});

describe("getCreateFormAttributes (via createAd)", () => {
  it("GETs the create-ad page before posting the ad", async () => {
    http = stubFetch(routes());

    await api.createAd(goldenAd(), []);

    const page = http.only("/plaats/1744/1745");
    expectSessionRequest(page, "GET", "/plaats/1744/1745");
    expect(page.headers).toEqual({});
    expect(page.body).toEqual({ kind: "none" });
    const order = http.calls.map((c) => c.url);
    expect(order.indexOf("/plaats/1744/1745")).toBeLessThan(order.indexOf("/plaats/ads"));
  });
});

// ============================================================================
// createAd — the payload whose field order is load-bearing
// ============================================================================

describe("createAd", () => {
  /**
   * The frozen body for the maximal ad: photos, bidding on, shipping selected,
   * buyer protection on. Field ORDER is load-bearing — see ADR-0015 and the
   * `MOVED:` comments in marktplaats-api.ts.
   */
  const FULL_PAIRS: [string, string][] = [
    ["images.ids", "img-1"],
    ["images.urls", "https://images.marktplaats.com/std/1.jpg"],
    ["images.ids", "img-2"],
    ["images.urls", "https://images.marktplaats.com/std/2.jpg"],
    ["images.ids", ""],
    ["title_nl-NL", "Vintage herenfiets"],
    ["description_nl-NL", "Nette vintage herenfiets, weinig gebruikt."],
    ["url", ""],
    ["singleSelectAttribute[type]", "Herenfiets"],
    ["deliveryMethod", "SHIPPING_AND_PICKUP"],
    ["buyerProtectionAllowed", "on"],
    ["shippingMethod", "dhl"],
    ["packageSize", "M"],
    ["shippingDetails.price", "695"],
    ["shippingDetails.provider", "other"],
    ["Dropdown-prijstype", "FAST_BID"],
    ["price.minimumBidPrice", ""],
    ["price.typeValue", "FAST_BID"],
    ["previousPriceType", ""],
    ["price.biddingEnabled", "on"],
    ["contactInformation.sellerName", "Jan Jansen"],
    ["contactInformation.phoneNumberSwitch", "false"],
    ["syi-address-radio-home", "syi-address-nl"],
    ["address-index-filter", "syi-address-nl"],
    ["contactInformation.postCode", "1011AB"],
    ["bundle-selection", "FREE"],
    ["selectedBundle", "FREE"],
    ["xsrf.token", CSRF_TOKEN],
    ["l1", "1744"],
    ["bucket", "12"],
    ["l2", "1745"],
    ["l2CategoryFullName", "Fietsen | Herenfietsen"],
    ["tmsid", "tms-xyz789"],
    ["timestamp", "1723500000000"],
    ["signature", "sig-abc123"],
  ];

  it("emits the full payload in the exact working order, byte-for-byte", async () => {
    http = stubFetch(routes());

    await api.createAd(goldenAd(), goldenPhotos());

    const req = http.only("/plaats/ads");
    expectSessionRequest(req, "POST", "/plaats/ads");
    // The CSRF token travels twice: as a header and as an `xsrf.token` form field.
    expect(req.headers).toEqual({ "x-mp-xsrf": CSRF_TOKEN });

    const body = urlencoded(req);
    expect(body.pairs).toEqual(FULL_PAIRS);
    // Independent of the decoded comparison above: catches an encoding change.
    expect(body.raw).toBe(
      "images.ids=img-1&images.urls=https%3A%2F%2Fimages.marktplaats.com%2Fstd%2F1.jpg" +
        "&images.ids=img-2&images.urls=https%3A%2F%2Fimages.marktplaats.com%2Fstd%2F2.jpg" +
        "&images.ids=&title_nl-NL=Vintage+herenfiets" +
        "&description_nl-NL=Nette+vintage+herenfiets%2C+weinig+gebruikt." +
        "&url=&singleSelectAttribute%5Btype%5D=Herenfiets" +
        "&deliveryMethod=SHIPPING_AND_PICKUP&buyerProtectionAllowed=on" +
        "&shippingMethod=dhl&packageSize=M&shippingDetails.price=695" +
        "&shippingDetails.provider=other&Dropdown-prijstype=FAST_BID" +
        "&price.minimumBidPrice=&price.typeValue=FAST_BID&previousPriceType=" +
        "&price.biddingEnabled=on&contactInformation.sellerName=Jan+Jansen" +
        "&contactInformation.phoneNumberSwitch=false" +
        "&syi-address-radio-home=syi-address-nl&address-index-filter=syi-address-nl" +
        "&contactInformation.postCode=1011AB&bundle-selection=FREE&selectedBundle=FREE" +
        `&xsrf.token=${CSRF_TOKEN}&l1=1744&bucket=12&l2=1745` +
        "&l2CategoryFullName=Fietsen+%7C+Herenfietsen" +
        "&tmsid=tms-xyz789&timestamp=1723500000000&signature=sig-abc123",
    );
    expect(body.raw).toBe(encodePairs(FULL_PAIRS));
  });

  it("omits every image field when there are no photos", async () => {
    http = stubFetch(routes());

    await api.createAd(goldenAd(), []);

    const body = urlencoded(http.only("/plaats/ads"));
    expect(body.pairs.filter(([k]) => k.startsWith("images."))).toEqual([]);
    // The trailing empty `images.ids` sentinel is tied to having uploaded media.
    expect(body.pairs).toEqual(FULL_PAIRS.filter(([k]) => !k.startsWith("images.")));
    expect(http.matching("/plaats/api/image/upload")).toHaveLength(0);
  });

  it("omits price.biddingEnabled entirely when bidding is off", async () => {
    http = stubFetch(routes());

    await api.createAd(
      goldenAd({ price: { biddingEnabled: false, priceCent: 12500, priceType: "FAST_BID" } }),
      [],
    );

    const body = urlencoded(http.only("/plaats/ads"));
    expect(body.pairs.map(([k]) => k)).not.toContain("price.biddingEnabled");
    // Everything else about the price block is unchanged.
    expect(body.pairs).toEqual(
      FULL_PAIRS.filter(([k]) => !k.startsWith("images.") && k !== "price.biddingEnabled"),
    );
  });

  it("omits buyerProtectionAllowed entirely when buyer protection is off", async () => {
    http = stubFetch(routes());

    await api.createAd(goldenAd({ isBuyerProtectionActiveOnListing: false }), []);

    const body = urlencoded(http.only("/plaats/ads"));
    expect(body.pairs.map(([k]) => k)).not.toContain("buyerProtectionAllowed");
    expect(body.pairs).toEqual(
      FULL_PAIRS.filter(([k]) => !k.startsWith("images.") && k !== "buyerProtectionAllowed"),
    );
  });

  it("omits the whole shipping block when no shipping option is selected", async () => {
    http = stubFetch(routes());

    await api.createAd(
      goldenAd({
        shippingInformation: { augmentedLabels: [], selectedShippingOptions: [] },
      }),
      [],
    );

    const shippingKeys = ["shippingMethod", "packageSize", "shippingDetails.price", "shippingDetails.provider"];
    const body = urlencoded(http.only("/plaats/ads"));
    expect(body.pairs).toEqual(
      FULL_PAIRS.filter(([k]) => !k.startsWith("images.") && !shippingKeys.includes(k)),
    );
  });

  it("deduplicates carriers and lowercases them, keeping one shippingMethod per carrier", async () => {
    const option = goldenAd().shippingInformation.selectedShippingOptions[0]!;
    http = stubFetch(routes());

    await api.createAd(
      goldenAd({
        shippingInformation: {
          augmentedLabels: [],
          selectedShippingOptions: [
            option,
            { ...option, id: "opt-2", cost: 995 },
            { ...option, id: "opt-3", carrierId: "DPD", cost: 795 },
          ],
        },
      }),
      [],
    );

    const body = urlencoded(http.only("/plaats/ads"));
    expect(body.pairs.filter(([k]) => k === "shippingMethod")).toEqual([
      ["shippingMethod", "dhl"],
      ["shippingMethod", "dpd"],
    ]);
    // Price comes from the first option only, regardless of how many there are.
    expect(body.pairs).toContainEqual(["shippingDetails.price", "695"]);
  });

  it("falls back to the category name when the ad has no `type` attribute", async () => {
    http = stubFetch(routes());

    await api.createAd(goldenAd({ attributes: [] }), []);

    const body = urlencoded(http.only("/plaats/ads"));
    expect(body.pairs).toContainEqual(["singleSelectAttribute[type]", "Fietsen | Herenfietsen"]);
  });

  it("defaults the bucket to 9 when the capture never resolved one", async () => {
    http = stubFetch(routes());

    await api.createAd(goldenAd({ bucketId: 0 }), []);

    const body = urlencoded(http.only("/plaats/ads"));
    expect(body.pairs).toContainEqual(["bucket", "9"]);
  });
});

// ============================================================================
// CSRF acquisition and the 403/419 retry path
// ============================================================================

describe("CSRF", () => {
  it("fetches the token once and reuses it across operations", async () => {
    http = stubFetch(routes({ method: "DELETE", url: "/seller/api/delete-ad", reply: { status: 200, text: "" } }));

    await api.deleteAd("m1");
    await api.deleteAd("m2");

    expectSessionRequest(http.only("/plaats/1/2"), "GET", "https://www.marktplaats.nl/plaats/1/2");
    expect(http.matching("/seller/api/delete-ad")).toHaveLength(2);
  });

  it("never sends a CSRF header on a GET", async () => {
    http = stubFetch(routes({ method: "GET", url: "/listings", reply: { json: { ads: [] } } }));

    await api.listMyAds();

    expect(http.matching("/plaats/1/2")).toHaveLength(0);
    expect(http.only("/listings").headers).toEqual({});
  });

  for (const status of [403, 419]) {
    it(`refreshes the token and retries once on ${status}`, async () => {
      http = stubFetch(
        routes(
          {
            method: "GET",
            url: "/plaats/1/2",
            reply: [{ html: csrfPageHtml(CSRF_TOKEN) }, { html: csrfPageHtml(REFRESHED_CSRF_TOKEN) }],
          },
          {
            method: "DELETE",
            url: "/seller/api/delete-ad",
            reply: [{ status, text: "stale token" }, { status: 200, text: "" }],
          },
        ),
      );

      await api.deleteAd("m2100000001");

      const attempts = http.matching("/seller/api/delete-ad");
      expect(attempts).toHaveLength(2);
      expect(attempts[0]!.headers["x-mp-xsrf"]).toBe(CSRF_TOKEN);
      expect(attempts[1]!.headers["x-mp-xsrf"]).toBe(REFRESHED_CSRF_TOKEN);
      // Same payload on the retry — only the token changes.
      expect(attempts[1]!.body).toEqual(attempts[0]!.body);
      expect(http.matching("/plaats/1/2")).toHaveLength(2);
    });
  }

  it("surfaces NotAuthenticatedError when the retry is refused too", async () => {
    http = stubFetch(
      routes({
        method: "DELETE",
        url: "/seller/api/delete-ad",
        reply: { status: 403, text: "nope" },
      }),
    );

    await expect(api.deleteAd("m1")).rejects.toThrow(errors.NotAuthenticatedError);
    expect(http.matching("/seller/api/delete-ad")).toHaveLength(2);
  });

  it("raises SpikePendingError when the page yields no token", async () => {
    http = stubFetch(
      routes(
        { method: "GET", url: "/plaats/1/2", reply: { html: "<html><body>no token</body></html>" } },
        { method: "DELETE", url: "/seller/api/delete-ad", reply: { status: 200, text: "" } },
      ),
    );

    await expect(api.deleteAd("m1")).rejects.toThrow("CSRF token extraction failed");
  });

  it("shares one in-flight refresh between concurrent callers", async () => {
    http = stubFetch(routes({ method: "DELETE", url: "/seller/api/delete-ad", reply: { status: 200, text: "" } }));

    await Promise.all([api.deleteAd("m1"), api.deleteAd("m2"), api.deleteAd("m3")]);

    expect(http.matching("/plaats/1/2")).toHaveLength(1);
  });
});

// ============================================================================
// Endpoint configuration
// ============================================================================

describe("endpoint config", () => {
  it("routes through a stored override instead of the built-in path", async () => {
    vi.resetModules();
    installChromeStub({
      endpointOverrides: { listMyAds: "/some/other/listings" },
    });
    api = await import("./marktplaats-api");
    http = stubFetch(routes({ method: "GET", url: "/some/other/listings", reply: { json: { ads: [] } } }));

    await api.listMyAds();

    expectSessionRequest(http.only("/some/other/listings"), "GET", "/some/other/listings");
  });

  it("raises SpikePendingError when an endpoint is not configured", async () => {
    vi.resetModules();
    installChromeStub({ endpointOverrides: { listMyAds: "" } });
    api = await import("./marktplaats-api");
    http = stubFetch(routes());

    await expect(api.listMyAds()).rejects.toThrow("Endpoint 'listMyAds' is not set");
  });
});
