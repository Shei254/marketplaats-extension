import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiRequestError, NoMarktplaatsTabError } from "../adapters/relay-marktplaats-client";
import { NotAuthenticatedError, SpikePendingError } from "../domain/marktplaats-client";
import type { ListingSummary } from "../domain/types";
import { describeAdsFailure, describePrice, formatEuro } from "./ads";
import { AdList } from "./AdList";
import type { WorkerPort } from "./screen";

const ADS: ListingSummary[] = [
  { id: "m1", title: "Vintage Eames lounge chair", priceCents: 125_000, priceType: "FIXED", biddingEnabled: false, reserved: false },
  { id: "m2", title: "Trek Marlin 7 mountainbike (M)", priceCents: 48_000, priceType: "FIXED", biddingEnabled: false, reserved: false },
];

/** The list, rendered without any of its behaviour — that is `AdList.test.tsx`. */
const render = (view: Parameters<typeof AdList>[0]["view"]): string =>
  renderToStaticMarkup(<AdList view={view} worker={{} as WorkerPort} onOutcome={() => {}} />);

describe("the ads themselves", () => {
  it("are a row each, titled and priced", () => {
    const markup = render({ status: "ready", ads: ADS });

    expect(markup).toContain("Vintage Eames lounge chair");
    expect(markup).toContain("Trek Marlin 7 mountainbike (M)");
    expect(markup).toMatch(/€\s?1\.250,00/);
    expect(markup).toMatch(/€\s?480,00/);
  });

  it("keep the whole title in the document, however narrow the window is", () => {
    // Truncation is CSS's job. Cutting the string instead would put an ad nobody
    // can identify in a 360px popup and leave nothing to hover for the rest.
    const long = { id: "m3", title: "A".repeat(120), priceCents: 100, priceType: "FIXED", biddingEnabled: false, reserved: false };

    expect(render({ status: "ready", ads: [long] })).toContain(`title="${"A".repeat(120)}"`);
  });

  it("each carry a Repost button that says what pressing it does", () => {
    // Repost deletes the ad first (ADR-0002), and a button that says only
    // "Repost" says so nowhere. The POC popup put it in the hover text.
    const markup = render({ status: "ready", ads: ADS });

    expect(markup).toContain("Repost</button>");
    expect(markup).toContain("and post it again, so it lands back on top");
  });
});

describe("an account with nothing on it", () => {
  it("is told so, rather than left with a spinner turning", () => {
    const markup = render({ status: "ready", ads: [] });

    expect(markup).toContain("You have no active ads.");
    expect(markup).not.toContain("mp-skeleton");
  });
});

describe("while they are coming", () => {
  it("shows the shape of the answer rather than an empty screen", () => {
    expect(render({ status: "loading" })).toContain("mp-skeleton");
  });
});

describe("when they could not be fetched", () => {
  it("says so where the list would be, and says why", () => {
    const markup = render({ status: "failed", message: "Open marktplaats.nl in a tab, then try again." });

    expect(markup).toContain("Could not load your ads.");
    expect(markup).toContain("Open marktplaats.nl in a tab");
    expect(markup).toContain("mp-note--error");
  });

  it("tells the user what only they can fix, rather than what broke", () => {
    // The two commonest failures are both theirs to fix, which is why these two
    // say what to do. Ported from the POC popup, whose copy this is.
    expect(describeAdsFailure(new NoMarktplaatsTabError())).toBe(
      "Open marktplaats.nl in a tab, then try again.",
    );
    expect(describeAdsFailure(new NotAuthenticatedError())).toBe(
      "Log in to Marktplaats first, then try again.",
    );
  });

  it("keeps the endpoint a pending spike names, which is the whole diagnosis", () => {
    expect(describeAdsFailure(new SpikePendingError("listMyAds is not configured"))).toContain(
      "listMyAds",
    );
  });

  it("names the status when Marktplaats refused the request", () => {
    expect(describeAdsFailure(new ApiRequestError("listMyAds", 403, ""))).toBe(
      "Marktplaats refused the request (HTTP 403).",
    );
  });

  it("still says something for an error nobody typed", () => {
    expect(describeAdsFailure(new Error("boom"))).toBe("boom");
    expect(describeAdsFailure("boom")).toBe("boom");
  });
});

/**
 * **Gereserveerd** (T71, #157) — the ad is promised to a buyer.
 *
 * The badge is the first place a seller learns this row is different from the
 * others, and the tooltip is where the mechanic answers the question it raises:
 * a repost deletes the ad first (ADR-0002), so *does reposting un-promise it?*
 * Until T71 the honest answer was yes, silently.
 */
describe("an ad that is reserved", () => {
  const reserved = { ...ADS[0]!, reserved: true };

  it("says so, and says what a repost does about it", () => {
    const markup = render({ status: "ready", ads: [reserved] });

    expect(markup).toContain("Gereserveerd");
    expect(markup).toContain("Reserved for a buyer. Reposting keeps it reserved.");
  });

  it("says it first, so a column of rows can be scanned for the promised ones", () => {
    // Ahead of the price chip, which is the trade this makes: the chips stop
    // lining up across rows so that the badges do. A row tint and a left rail
    // were both unavailable — `[data-ticked]` and `[data-state="busy"]` already
    // own that background and that inset rail.
    const markup = render({ status: "ready", ads: [reserved] });

    expect(markup.indexOf("Gereserveerd")).toBeLessThan(markup.indexOf("Vraagprijs"));
  });

  it("is the only row that says it", () => {
    const markup = render({ status: "ready", ads: [reserved, ADS[1]!] });

    expect(markup.match(/Gereserveerd/g)).toHaveLength(1);
  });

  /**
   * The meta line draws nothing at all for an ad whose price it cannot describe,
   * and the badge must not be lost in that hole: *reserved* is a fact about the ad
   * independent of what it costs.
   */
  it("says it even on a row that has nothing to say about the price", () => {
    const unpriceable = { ...reserved, priceType: "SOMETHING_NEW", priceCents: 0 };

    expect(render({ status: "ready", ads: [unpriceable] })).toContain("Gereserveerd");
  });
});

describe("prices", () => {
  it("are Dutch, because the marketplace and the seller are", () => {
    expect(formatEuro(125_000)).toMatch(/^€\s?1\.250,00$/);
    expect(formatEuro(0)).toMatch(/^€\s?0,00$/);
  });
});

describe("what kind of price an ad has", () => {
  const ad = (over: Partial<ListingSummary>): ListingSummary => ({
    id: "m1",
    title: "Lego Jurassic World Indominus rex",
    priceCents: 0,
    priceType: "FIXED",
    biddingEnabled: false,
    reserved: false,
    ...over,
  });

  it("is the seller's own word for it, beside the number", () => {
    expect(describePrice(ad({ priceType: "FIXED", priceCents: 125_000 }))).toMatchObject({
      label: "",
      bidding: false,
    });
    expect(describePrice(ad({ priceType: "FIXED", priceCents: 125_000 })).amount).toMatch(
      /€\s?1\.250,00/,
    );
  });

  it("is the whole answer where there is no number, rather than a zero", () => {
    // The bug this exists for: three different things — free, priced in the
    // description, taking bids — all drawn as "€ 0,00".
    expect(describePrice(ad({ priceType: "FREE" }))).toMatchObject({
      label: "Gratis",
      amount: null,
    });
    expect(describePrice(ad({ priceType: "SEE_DESCRIPTION" }))).toMatchObject({
      label: "Zie beschrijving",
      amount: null,
    });
  });

  it("names no number at all on a bid ad, whatever the row carries", () => {
    // **T67.** There is no field here that is the floor the seller set:
    // `minimumBidPriceCents` is the minimum bid *placed* and is no longer on the
    // summary at all, and a bid ad's `priceCents` is `0` on the live rows and
    // `12500` in the golden capture fixture, with nobody having established
    // which. So the chip is the whole row, and a `priceCents` that happens to be
    // set must not talk it into drawing one.
    for (const priceType of ["FAST_BID", "MIN_BID"]) {
      expect(describePrice(ad({ priceType }))).toMatchObject({ label: "Bieden", amount: null });
      expect(describePrice(ad({ priceType, priceCents: 12_500 }))).toMatchObject({
        label: "Bieden",
        amount: null,
      });
    }
  });

  it("adds that bids are taken only where the label has not said it", () => {
    expect(describePrice(ad({ priceType: "FIXED", priceCents: 100, biddingEnabled: true })).bidding).toBe(
      true,
    );
    // The chip already says "Bieden"; saying it twice is what the row looked like
    // before this.
    expect(describePrice(ad({ priceType: "FAST_BID", biddingEnabled: true })).bidding).toBe(false);
  });

  it("says nothing at all for a type Marktplaats has added since", () => {
    // A wire constant printed at a seller is worse than an empty line, and a 0
    // under a type we cannot name is not a fact about the ad.
    expect(describePrice(ad({ priceType: "AUCTION_HOUSE" }))).toMatchObject({
      label: null,
      amount: null,
    });
    // Except that a price it does carry is still a price.
    expect(describePrice(ad({ priceType: "AUCTION_HOUSE", priceCents: 100 })).amount).toMatch(
      /€\s?1,00/,
    );
  });
});
