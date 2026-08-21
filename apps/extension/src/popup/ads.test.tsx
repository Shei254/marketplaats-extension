import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiRequestError, NoMarktplaatsTabError } from "../adapters/relay-marktplaats-client";
import { NotAuthenticatedError, SpikePendingError } from "../domain/marktplaats-client";
import type { ListingSummary } from "../domain/types";
import { describeAdsFailure, formatEuro } from "./ads";
import { AdList } from "./AdList";
import type { WorkerPort } from "./screen";

const ADS: ListingSummary[] = [
  { id: "m1", title: "Vintage Eames lounge chair", priceCents: 125_000 },
  { id: "m2", title: "Trek Marlin 7 mountainbike (M)", priceCents: 48_000 },
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
    const long = { id: "m3", title: "A".repeat(120), priceCents: 100 };

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

describe("prices", () => {
  it("are Dutch, because the marketplace and the seller are", () => {
    expect(formatEuro(125_000)).toMatch(/^€\s?1\.250,00$/);
    expect(formatEuro(0)).toMatch(/^€\s?0,00$/);
  });
});
