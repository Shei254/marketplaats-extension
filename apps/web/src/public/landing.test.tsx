// @vitest-environment happy-dom
import type { FreeTier, Plan } from "@mprelist/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Landing, LandingPage, STORE_URL, largestOf } from "./landing";
import { actionFor, freeActionFor, yearlySaving } from "./plan-cards";
import type { PlansOnOffer } from "./plans-on-offer";
import { NOBODY, type Account, type Choice, type Viewer } from "./viewer";

/**
 * The landing page (T58): a few of the listing's claims in fewer words, the install
 * link twice, and the plan cards `GET /api/plans` answers a visitor with no token —
 * with buttons since T85 (ADR-0036), whose meaning depends on who is looking.
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

const FREE: FreeTier = { tier: { code: "free", name: "Gratis" }, relistQuotaPerPeriod: 3, features: {} };

const PAY_WITH =
  "Uw betaling wordt veilig verwerkt via Stripe. U kunt eenvoudig kiezen uit verschillende " +
  "betaalmethoden, waaronder iDEAL | Wero, PayPal, creditcard en debitcard.";
const ON_SALE: PlansOnOffer = { status: "ready", plans: [PRO, UNLIMITED], freeTier: null, paymentMethods: ["card", "ideal"] };

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
  it("lead with how many reposts each plan grants, and its monthly price to begin with", () => {
    const markup = page(ON_SALE);

    expect(markup).toContain('<p class="web-plan-number">50</p>');
    expect(markup).toContain("herplaatsingen per maand");
    expect(markup).toMatch(/€\s9,99<\/b> per maand/);
    expect(markup).toContain('<p class="web-plan-number">∞</p>');
    expect(markup).toContain("onbeperkt herplaatsen");
  });

  it("fill the plan that grants the most, which unlimited always does", () => {
    const markup = page(ON_SALE);

    expect(markup.match(/web-plan--featured/g)).toHaveLength(1);
    expect(markup.indexOf("web-plan--featured")).toBeGreaterThan(markup.indexOf(">Pro<"));
    expect(largestOf([PRO, UNLIMITED])).toBe("max");
  });

  it("fill none when there is nothing to be larger than, or two are equal", () => {
    expect(largestOf([PRO])).toBeUndefined();
    expect(largestOf([PRO, { ...PRO, tier: { code: "pro2", name: "Pro 2" } }])).toBeUndefined();
  });

  it("call no plan popular, since nothing here knows", () => {
    expect(page(ON_SALE).toLowerCase()).not.toContain("populair");
  });

  it("say how a buyer can pay, in the operator's own words", () => {
    expect(page(ON_SALE)).toContain(PAY_WITH);
  });

  it("say it whatever Stripe says it offers, since the sentence is fixed copy", () => {
    expect(page({ ...ON_SALE, paymentMethods: [] })).toContain(PAY_WITH);
    expect(page({ ...ON_SALE, paymentMethods: ["twint"] } as PlansOnOffer)).toContain(PAY_WITH);
  });

  it("and not beside a free card alone, where there is nothing to pay for", () => {
    expect(page({ ...ON_SALE, plans: [], freeTier: FREE })).not.toContain("Stripe");
  });

  it("offer the switcher when some plan is sold yearly, and not otherwise", () => {
    expect(page(ON_SALE)).toContain('aria-label="Betaalritme"');
    expect(page({ ...ON_SALE, plans: [UNLIMITED] })).not.toContain('aria-label="Betaalritme"');
  });

  it("show the free tier on offer beside the plans, and send a visitor to install it", () => {
    const markup = page({ ...ON_SALE, freeTier: FREE });

    expect(markup).toContain(">Gratis<");
    expect(markup).toContain('<p class="web-plan-number">3</p>');
    expect(markup).toContain(`href="${STORE_URL}">Gratis beginnen</a>`);
  });

  it("and no free card when there is no free tier on offer", () => {
    expect(page(ON_SALE)).not.toContain("Gratis beginnen");
  });

  it("draw nothing when nothing is on sale and nothing is free, rather than a fault", () => {
    const markup = page({ status: "ready", plans: [], freeTier: null, paymentMethods: ["ideal"] });

    expect(markup).not.toContain('class="web-plan"');
    expect(markup).not.toContain("Stripe");
    expect(markup).not.toContain("niet worden geladen");
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

describe("a card's button, by who is looking", () => {
  const signedIn = (
    tierCode: string | null,
    paying: boolean,
    rhythm: string | null = null,
    more: Partial<Extract<Viewer, { kind: "signed-in" }>> = {},
  ): Viewer => ({ ...viewerOn(tierCode, paying, rhythm), ...more });

  it("signs a visitor in, carrying the card they pressed", () => {
    expect(actionFor(PRO, "year", { kind: "signed-out" })).toEqual({
      kind: "sign-in",
      label: "Kies Pro",
      choice: { tierCode: "pro", interval: "year" },
    });
  });

  it("waits while nobody knows yet who is looking", () => {
    expect(actionFor(PRO, "month", { kind: "checking" }).kind).toBe("wait");
  });

  it("buys for somebody Stripe is billing for nothing", () => {
    expect(actionFor(PRO, "month", signedIn("free", false)).kind).toBe("buy");
    expect(actionFor(PRO, "month", signedIn(null, false)).kind).toBe("buy");
  });

  it("marks a payer's own plan at their own rhythm, and switches them to the other", () => {
    expect(actionFor(PRO, "month", signedIn("pro", true, "month"))).toEqual({
      kind: "current",
      label: "Huidig abonnement",
    });
    expect(actionFor(PRO, "year", signedIn("pro", true, "month"))).toMatchObject({
      kind: "switch",
      label: "Overstappen naar jaarlijks",
    });
  });

  it("calls their own plan theirs at either rhythm when nobody could read which they pay", () => {
    expect(actionFor(PRO, "year", signedIn("pro", true, null)).kind).toBe("current");
  });

  it("switches a payer to another plan, and never sells them a second one", () => {
    expect(actionFor(UNLIMITED, "month", signedIn("pro", true, "month"))).toEqual({
      kind: "switch",
      label: "Overstappen naar Max",
      choice: { tierCode: "max", interval: "month" },
    });
  });

  it("offers a payer in Dunning nothing to switch to (T90)", () => {
    expect(actionFor(UNLIMITED, "month", signedIn("pro", true, "month", { inDunning: true })).kind).toBe("blocked");
    expect(actionFor(PRO, "year", signedIn("pro", true, "month", { inDunning: true })).kind).toBe("blocked");
  });

  it("says when a pending switch starts on the card it lands on (T90)", () => {
    const pendingSwitch = { tier: { code: "max", name: "Max" }, rhythm: "month", at: RENEWS };
    expect(actionFor(UNLIMITED, "month", signedIn("pro", true, "month", { pendingSwitch }))).toEqual({
      kind: "pending",
      label: "Vanaf 12 december",
    });
  });

  it("on the free card: install for a visitor, current for its holder, cancel for a payer", () => {
    expect(freeActionFor(FREE, { kind: "signed-out" }).kind).toBe("install");
    expect(freeActionFor(FREE, signedIn("free", false)).kind).toBe("current");
    expect(freeActionFor(FREE, signedIn("pro", true, "month"))).toEqual({ kind: "cancel", label: "Opzeggen" });
    expect(freeActionFor(FREE, signedIn(null, false)).kind).toBe("none");
  });
});

describe("what a year saves, and what a switch costs", () => {
  it("is computed from the plan's own two prices", () => {
    // 99 against twelve times 9,99 is 17% off.
    expect(yearlySaving(PRO)).toBe(17);
  });

  it("and is nothing without both, or when the year is not cheaper", () => {
    expect(yearlySaving(UNLIMITED)).toBeUndefined();
    const dearer = { ...PRO, prices: [PRO.prices[0]!, { amount: 12000, currency: "eur", interval: "year" }] };
    expect(yearlySaving(dearer)).toBeUndefined();
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

  const button = (text: string) =>
    [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text));

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
    expect(host.textContent).toContain("herplaatsingen per maand");
  });

  it("asks again when the visitor retries, and draws what comes back", async () => {
    const answers: PlansOnOffer[] = [{ status: "unavailable" }, ON_SALE];
    await act(async () => {
      root.render(<Landing loadPlans={async () => answers.shift() ?? ON_SALE} />);
    });
    expect(host.textContent).toContain("niet worden geladen");

    await act(async () => button("Opnieuw proberen")?.click());

    expect(host.textContent).toContain("herplaatsingen per maand");
    expect(host.textContent).not.toContain("niet worden geladen");
  });

  it("says it has settled once the plans answer, so a link to #abonnementen can land", async () => {
    let answer: (plans: PlansOnOffer) => void = () => {};
    let settled = 0;
    await act(async () => {
      root.render(
        <Landing
          loadPlans={() => new Promise((resolve) => (answer = resolve))}
          onSettled={() => (settled += 1)}
        />,
      );
    });
    expect(settled).toBe(0);
    expect(host.querySelector("#abonnementen")).not.toBeNull();

    await act(async () => answer(ON_SALE));
    expect(settled).toBe(1);
  });

  it("shows the yearly prices under Jaarlijks, and keeps a plan sold monthly only", async () => {
    await act(async () => {
      root.render(<Landing loadPlans={async () => ON_SALE} />);
    });

    await act(async () => button("Jaarlijks")?.click());

    expect(host.textContent).toMatch(/€\s99,00 per jaar/);
    expect(host.textContent).toMatch(/€\s8,25 per maand · bespaar 17%/);
    expect(host.textContent).toContain("Alleen maandelijks");
    expect(host.textContent).toContain("Max");
  });

  it("keeps every grant per month under Jaarlijks, since a rhythm changes the price and not the grant", async () => {
    // ADR-0037: annual Pro is Pro's monthly grant twelve times, never once a year.
    await act(async () => {
      root.render(<Landing loadPlans={async () => ON_SALE} />);
    });

    await act(async () => button("Jaarlijks")?.click());

    expect(host.textContent).toContain("herplaatsingen per maand");
    expect(host.textContent).not.toContain("herplaatsingen per jaar");
  });

  it("signs a visitor in with the card and rhythm they pressed", async () => {
    const chose: (Choice | undefined)[] = [];
    await act(async () => {
      root.render(
        <Landing loadPlans={async () => ON_SALE} account={{ ...NOBODY, signIn: (choice) => chose.push(choice) }} />,
      );
    });

    await act(async () => button("Jaarlijks")?.click());
    await act(async () => button("Kies Pro")?.click());

    expect(chose).toEqual([{ tierCode: "pro", interval: "year" }]);
  });

  it("asks Stripe what a switch costs, and switches now only once Nu is pressed (T90)", async () => {
    const switched: Choice[] = [];
    const account: Account = {
      ...NOBODY,
      viewer: viewerOn("pro", true, "month"),
      previewSwitch: async () => ({ status: "ready", amount: 1500, currency: "eur", renewsAt: RENEWS }),
      switchPlan: async (choice) => {
        switched.push(choice);
        return { status: "switched" };
      },
    };
    await act(async () => {
      root.render(<Landing loadPlans={async () => ON_SALE} account={account} />);
    });

    await act(async () => button("Overstappen naar Max")?.click());

    const dialog = () => host.querySelector('[role="dialog"]')?.textContent?.replace(/\u00a0/g, " ") ?? "";
    expect(dialog()).toContain("Je betaalt vandaag € 15,00.");
    expect(dialog()).toContain("Je nieuwe maand begint vandaag met onbeperkt herplaatsen; wat over is van Pro vervalt.");
    expect(switched).toEqual([]);

    await act(async () => dialogButton("Nu")?.click());

    expect(switched).toEqual([{ tierCode: "max", interval: "month" }]);
    expect(dialog()).toContain("Gelukt");
  });

  it("or at renewal, which charges nothing today (T90)", async () => {
    const scheduled: Choice[] = [];
    const account: Account = {
      ...NOBODY,
      viewer: viewerOn("pro", true, "month"),
      previewSwitch: async () => ({ status: "ready", amount: 1500, currency: "eur", renewsAt: RENEWS }),
      scheduleSwitch: async (choice) => {
        scheduled.push(choice);
        return { status: "scheduled" };
      },
    };
    await act(async () => {
      root.render(<Landing loadPlans={async () => ON_SALE} account={account} />);
    });

    await act(async () => button("Overstappen naar Max")?.click());
    await act(async () => dialogButton("Op 12 december")?.click());

    expect(scheduled).toEqual([{ tierCode: "max", interval: "month" }]);
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Gelukt");
  });

  it("shows a pending switch on the held card, with Ongedaan maken (T90)", async () => {
    let undone = 0;
    const account: Account = {
      ...NOBODY,
      viewer: {
        ...viewerOn("pro", true, "month"),
        pendingSwitch: { tier: { code: "max", name: "Max" }, rhythm: "month", at: RENEWS },
      } as Viewer,
      undoSwitch: async () => {
        undone++;
        return { status: "undone" };
      },
    };
    await act(async () => {
      root.render(<Landing loadPlans={async () => ON_SALE} account={account} />);
    });

    expect(host.textContent).toContain("Gaat op 12 december over naar Max");
    expect(host.textContent).toContain("Vanaf 12 december");
    await act(async () => button("Ongedaan maken")?.click());
    expect(undone).toBe(1);
  });

  it("tells a payer in Dunning to pay the open invoice first (T90)", async () => {
    const account: Account = { ...NOBODY, viewer: { ...viewerOn("pro", true, "month"), inDunning: true } as Viewer };
    await act(async () => {
      root.render(<Landing loadPlans={async () => ON_SALE} account={account} />);
    });

    expect(host.textContent).toContain("Betaal eerst je openstaande factuur via Betaling beheren.");
    expect(button("Overstappen naar Max")?.disabled).toBe(true);
  });
});

/** The day a Scheduled switch takes over in these tests, at ten in the morning local time. */
const RENEWS = new Date(2026, 11, 12, 10).toISOString();

/** Somebody signed in, on that tier, nothing pending and not in Dunning. */
function viewerOn(
  tierCode: string | null,
  paying: boolean,
  rhythm: string | null,
): Extract<Viewer, { kind: "signed-in" }> {
  return {
    kind: "signed-in",
    tierCode,
    tierName: tierCode === null ? null : tierCode.charAt(0).toUpperCase() + tierCode.slice(1),
    grant: 50,
    paying,
    rhythm,
    inDunning: false,
    pendingSwitch: null,
    picked: null,
  };
}

function dialogButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (b) => b.textContent === label,
  );
}
