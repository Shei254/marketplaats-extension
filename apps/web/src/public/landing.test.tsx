// @vitest-environment happy-dom
import type { Plan } from "@mprelist/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Landing, LandingPage, STORE_URL, largestOf } from "./landing";
import type { PlansOnOffer } from "./plans-on-offer";

/**
 * The landing page (T58): a few of the listing's claims in fewer words, the install
 * link twice, and the plan cards `GET /api/plans` answers a visitor with no token.
 */
const PRO: Plan = {
  tier: { code: "pro", name: "Pro" },
  relistQuotaPerPeriod: 50,
  features: {},
  prices: [
    { amount: 999, currency: "eur", interval: "month" },
    { amount: 9900, currency: "eur", interval: "year" },
  ],
};

const UNLIMITED: Plan = {
  tier: { code: "max", name: "Max" },
  relistQuotaPerPeriod: null,
  features: {},
  prices: [{ amount: 3999, currency: "eur", interval: "month" }],
};

const ON_SALE: PlansOnOffer = { status: "ready", plans: [PRO, UNLIMITED], paymentMethods: ["card", "ideal"] };

const page = (plans: PlansOnOffer | "loading"): string =>
  renderToStaticMarkup(<LandingPage plans={plans} onRetry={() => {}} />);

describe("the landing page's copy", () => {
  const markup = page("loading");

  it("says what the product does, in fewer words than the listing and none it lacks", () => {
    expect(markup).toContain("Zet je advertentie weer bovenaan");
    expect(markup).toContain("Zo werkt het");
  });

  it("leaves what the listing calls good to know to the Terms and the Privacy page", () => {
    // Decided with the full-width redesign: the delete-first sentence is section 5
    // of the Terms (Site.test.tsx asserts it is there), and the header links both.
    expect(markup).not.toContain("Goed om te weten");
  });

  it("never says Marktplaats approves", () => {
    // The disclaimer itself is the frame's, under the footer (see Site.test.tsx).
    // The words store/listing.md forbids, because Marktplaats's terms contradict
    // them or they imply its approval.
    for (const word of ["automatisch", "officieel", "toegestaan", "volgens de regels", "veilig voor je account", "geen risico"]) {
      expect(markup.toLowerCase(), word).not.toContain(word);
    }
  });

  it("sends a visitor to the Web Store listing to install it", () => {
    expect(STORE_URL).toBe("https://chromewebstore.google.com/detail/cefnlogjhmeceojlaoionfjpdkklmnaf");
    expect(markup).toContain(`href="${STORE_URL}"`);
    expect(markup).toContain("Toevoegen aan Chrome");
  });

  it("offers it again at the end of the page, as the same link", () => {
    expect(markup.split(`href="${STORE_URL}"`)).toHaveLength(3);
  });

  it("draws the demo's still frame as the outcome: the visitor's ad on top", () => {
    // The animation starts from the markup, and reduced motion leaves only the
    // markup — so the first row has to be the visitor's, already "Bovenaan".
    const demo = markup.slice(markup.indexOf('class="web-repost-list"'));
    expect(demo.indexOf("Jouw fiets")).toBeLessThan(demo.indexOf("Nieuw geplaatst"));
    expect(demo).toContain('<span class="web-repost-top web-after">Bovenaan</span>');
  });
});

describe("the plan cards", () => {
  it("show each plan as the popup words it, at every rhythm it is sold at", () => {
    const markup = page(ON_SALE);

    expect(markup).toContain("Pro");
    expect(markup).toContain("50 herplaatsingen per maand");
    expect(markup).toMatch(/€\s9,99 per maand/);
    expect(markup).toMatch(/€\s99,00 per jaar/);
    expect(markup).toContain("Onbeperkt herplaatsen");
  });

  it("ring the plan that grants the most, which unlimited always does", () => {
    const markup = page(ON_SALE);

    expect(markup.match(/class="web-plan web-plan--featured"/g)).toHaveLength(1);
    expect(markup.indexOf("web-plan--featured")).toBeGreaterThan(markup.indexOf("Pro"));
    expect(largestOf([PRO, UNLIMITED])).toBe("max");
  });

  it("ring none when there is nothing to be larger than, or two are equal", () => {
    expect(largestOf([PRO])).toBeUndefined();
    expect(largestOf([PRO, { ...PRO, tier: { code: "pro2", name: "Pro 2" } }])).toBeUndefined();
  });

  it("call no plan popular, since nothing here knows", () => {
    expect(page(ON_SALE).toLowerCase()).not.toContain("populair");
  });

  it("say how a buyer can pay, in the popup's order", () => {
    expect(page(ON_SALE)).toContain("Je kunt betalen met iDEAL of creditcard.");
  });

  it("sell nothing here: buying happens in the extension", () => {
    // ADR-0017: Checkout is opened from the popup, which knows who is buying.
    const markup = page(ON_SALE);

    expect(markup).not.toContain("<button");
    expect(markup).toContain("in de extensie");
  });

  it("draw nothing when nothing is on sale, rather than a fault", () => {
    const markup = page({ status: "ready", plans: [], paymentMethods: ["ideal"] });

    // The lead-in still says where plans are chosen, and does not trail off into
    // a colon with nothing after it.
    expect(markup).toContain("kies je in de extensie een betaald abonnement.");
    expect(markup).not.toContain("abonnement:");

    expect(markup).not.toContain('class="web-plan"');
    expect(markup).not.toContain("Je kunt betalen met");
    expect(markup).not.toContain("niet worden geladen");
  });

  it("leave the payment sentence out when there is nothing it can name", () => {
    expect(page({ ...ON_SALE, paymentMethods: ["twint"] } as PlansOnOffer)).not.toContain("Je kunt betalen met");
  });

  it("say so when the prices could not be had, and never guess one", () => {
    const markup = page({ status: "unavailable" });

    expect(markup).toContain("De prijzen kunnen nu niet worden geladen");
    expect(markup).toContain("Opnieuw proberen");
    expect(markup).not.toContain("€");
  });

  it("hold their place while they load, without a price", () => {
    const markup = page("loading");

    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain("€");
  });
});

describe("the landing page, asking", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("asks once, and draws the cards it was answered", async () => {
    let asked = 0;
    await act(async () => {
      root.render(
        <Landing
          loadPlans={async () => {
            asked += 1;
            return ON_SALE;
          }}
        />,
      );
    });

    expect(asked).toBe(1);
    expect(host.textContent).toContain("50 herplaatsingen per maand");
  });

  it("asks again when the visitor retries, and draws what comes back", async () => {
    const answers: PlansOnOffer[] = [{ status: "unavailable" }, ON_SALE];
    await act(async () => {
      root.render(<Landing loadPlans={async () => answers.shift() ?? ON_SALE} />);
    });
    expect(host.textContent).toContain("niet worden geladen");

    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Opnieuw proberen");
    await act(async () => retry?.click());

    expect(host.textContent).toContain("50 herplaatsingen per maand");
    expect(host.textContent).not.toContain("niet worden geladen");
  });
});
