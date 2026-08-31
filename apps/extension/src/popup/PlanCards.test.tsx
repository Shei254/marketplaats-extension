import type { DisplayState, Plan } from "@mprelist/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlanCards } from "./PlanCards";
import { MANAGING, NOT_OPENING, type Handoff, type PlansView } from "./plans";

const FREE: DisplayState = {
  subscriptionStatus: "ACTIVE",
  tier: { code: "free", name: "Free" },
  quotaRemaining: 0,
  relistQuotaPerPeriod: 3,
  resetAt: "2026-09-14T08:31:22.101Z",
  features: {},
};

const PRO: Plan = {
  tier: { code: "pro", name: "Pro" },
  relistQuotaPerPeriod: 50,
  features: {},
  prices: [{ amount: 999, currency: "eur", interval: "month" }],
};

const POWER: Plan = {
  tier: { code: "power", name: "Power" },
  relistQuotaPerPeriod: 200,
  features: {},
  prices: [{ amount: 1999, currency: "eur", interval: "month" }],
};

// `paymentMethods` is empty throughout: the ways to pay are the plans *screen*'s
// line under the title (T65, #137), and no card reads them. That they can be
// empty here without changing a single assertion is the separation working.
const ON_SALE: PlansView = { status: "ready", plans: [PRO, POWER], paymentMethods: [] };

const render = (
  view: PlansView,
  current: DisplayState = FREE,
  handoff: Handoff = NOT_OPENING,
): string =>
  renderToStaticMarkup(
    <PlanCards
      view={view}
      current={current}
      handoff={handoff}
      onUpgrade={() => {}}
      onRetry={() => {}}
    />,
  );

describe("the cards", () => {
  const markup = render(ON_SALE);

  it("show what each plan costs and what it grants", () => {
    expect(markup).toContain("Pro");
    expect(markup).toContain("9,99");
    expect(markup).toContain("50 relists a month");
    expect(markup).toContain("Power");
    expect(markup).toContain("200 relists a month");
  });

  it("keep the order the backend sent them in", () => {
    // The route orders them (T49, #80) and the cheapest-first reading is the
    // canvas's. Re-sorting here would be a second opinion about the same list.
    expect(markup.indexOf("Pro")).toBeLessThan(markup.indexOf("Power"));
  });

  it("offer a button per rhythm on every plan that is not the one they are on", () => {
    // One button per price, each saying its own amount (T62, #128) — rather than a
    // toggle above the cards, which would hide a plan that is monthly-only.
    expect(markup).toContain("9,99");
    expect(markup).toContain("19,99");
    // Two buyable buttons, one per plan — the third card is the one they are on.
    expect([...markup.matchAll(/mp-btn--primary/g)]).toHaveLength(2);
  });

  it("and one per rhythm where a plan is sold at two", () => {
    // The whole of the ticket at the card level: monthly and annual Pro are one
    // plan a buyer chooses a rhythm for, not two plans to compare.
    const both: Plan = { ...PRO, prices: [...PRO.prices, { amount: 9900, currency: "eur", interval: "year" }] };
    // The buyer is on Free, which is not on sale, so its card is the synthetic one
    // and Pro's is the only one with buttons.
    const shown = render({ status: "ready", plans: [both], paymentMethods: [] });

    expect(shown).toContain("9,99");
    expect(shown).toContain("99,00");
    // Two buttons, and deliberately not two of the same button: the first rhythm
    // is the card's decision and the second is its alternative, so they are a
    // primary and a secondary rather than two slabs of accent. Counted by tone
    // rather than by shape, since the Free card above them is a block button too.
    expect([...shown.matchAll(/mp-btn--primary/g)]).toHaveLength(1);
    expect([...shown.matchAll(/mp-btn--secondary/g)]).toHaveLength(1);
    // Still one card for the plan, with one name and one quota line.
    expect([...shown.matchAll(/50 relists/g)]).toHaveLength(1);
  });
});

describe("the plan they are already on", () => {
  it("is a card of its own when nobody can buy it", () => {
    // The free tier is absent from `/api/plans` by construction, so without this
    // the screen would show two plans and no answer to "what do I have now".
    const markup = render(ON_SALE);

    expect(markup).toContain("Free");
    expect(markup).toContain("Current");
    expect(markup).toContain("Your plan");
  });

  it("carries no amount, because nothing here knows one", () => {
    // A tier missing from `/api/plans` is either free — no Stripe Price at all —
    // or one withdrawn under the people still paying for it (ADR-0019), and €0
    // would be right about one of them and a lie about the other. What it says
    // instead is the thing `/api/me` does know.
    const markup = render(ON_SALE);

    expect(markup).toContain("0 of 3 relists left");
    expect(markup).not.toContain("€ 0,00");
  });

  it("is marked in place when it is one of the plans on sale", () => {
    // A subscriber on Pro sees their own card as theirs rather than a fourth card
    // above the three, and it is not purchasable twice.
    const pro: DisplayState = { ...FREE, tier: { code: "pro", name: "Pro" }, relistQuotaPerPeriod: 50 };
    const markup = render(ON_SALE, pro);

    expect(markup).toContain("Current");
    expect(markup).toContain("Your plan");
    // One buyable rhythm, on Power. Not on the plan they hold.
    expect(markup).toContain("19,99");
    expect(markup).toContain("Your plan");
  });
});

describe("while a Checkout tab is being opened", () => {
  const opening = render(ON_SALE, FREE, { kind: "opening", what: "pro:month" });

  it("says so on the rhythm that was clicked", () => {
    // Keyed by tier *and* rhythm: a plan with two buttons would otherwise light
    // both when one was pressed.
    expect(opening).toContain("Opening…");
    expect([...opening.matchAll(/Opening…/g)]).toHaveLength(1);
  });

  it("and locks every other one", () => {
    // Two Checkout tabs from two clicks is two sessions and one confused buyer —
    // and this popup is about to be destroyed by the first of them anyway.
    expect(opening).toContain("mp-btn--locked");
    expect(opening).not.toContain("mp-btn--primary");
  });

  it("and locks them for the Portal too, which is opening a tab just the same", () => {
    // The Customer Portal is opened from the screen around these cards, and it
    // destroys this popup exactly as a Checkout does. No card says "Opening…",
    // because none of them is the thing being opened.
    const managing = render(ON_SALE, FREE, { kind: "opening", what: MANAGING });

    expect(managing).toContain("mp-btn--locked");
    expect(managing).not.toContain("Opening…");
  });
});

describe("when there is nothing to show", () => {
  it("says nothing is on sale rather than that something went wrong", () => {
    // Every stack whose Stripe Prices have not been created yet (T22, #28). The
    // card for the plan they are on is still there, because they still have one.
    const markup = render({ status: "ready", plans: [], paymentMethods: [] });

    expect(markup).toContain("no paid plans on offer");
    expect(markup).toContain("Your plan");
  });

  it("says prices could not be loaded when Stripe could not be asked", () => {
    // `503`, which is all-or-nothing by construction: never a guessed amount and
    // never a card whose button would open a Checkout for one.
    const markup = render({ status: "failed" });

    expect(markup).toContain("Prices couldn’t be loaded");
    expect(markup).toContain("Try again");
    expect(markup).not.toContain("a month");
  });

  it("shows the shape of the answer while it is loading", () => {
    const markup = render({ status: "loading" });

    expect(markup).toContain("mp-skeleton");
    expect(markup).not.toContain("a month");
  });
});
