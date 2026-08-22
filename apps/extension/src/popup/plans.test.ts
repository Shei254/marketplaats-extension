import type { Plan } from "@mprelist/contracts";
import { describe, expect, it } from "vitest";

import { grantOf, handoffFailure, priceOf } from "./plans";

/** The one rhythm this fixture is sold at, named because several assertions want it. */
const FIRST_PRICE = { amount: 999, currency: "eur", interval: "month" } as const;

const PRO: Plan = {
  tier: { code: "pro", name: "Pro" },
  relistQuotaPerPeriod: 50,
  features: {},
  prices: [FIRST_PRICE],
};

describe("what a plan costs", () => {
  it("is Dutch money, like every other amount on this surface", () => {
    // `formatEuro` one file over renders a Marktplaats price the same way. Two
    // spellings of money in one popup would be the popup disagreeing with itself.
    expect(priceOf(FIRST_PRICE)).toMatch(/9,99/);
    expect(priceOf(FIRST_PRICE)).toContain("€");
  });

  it("is read in the currency's smallest unit, as Stripe counts it", () => {
    expect(priceOf({ amount: 1999, currency: "eur", interval: "month" })).toMatch(/19,99/);
    expect(priceOf({ amount: 0, currency: "eur", interval: "month" })).toMatch(/0,00/);
  });

  it("names a currency it has no symbol for by its code", () => {
    // Any well-formed ISO code is one `Intl` will render, symbol or not — so a
    // currency chosen in the Stripe dashboard shows as an amount beside its code
    // rather than as a guess.
    expect(priceOf({ amount: 999, currency: "zzz", interval: "month" })).toContain("ZZZ");
    expect(priceOf({ amount: 999, currency: "zzz", interval: "month" })).toContain("9,99");
  });

  it("falls back rather than throwing on a code that is not one at all", () => {
    // `Intl` raises a RangeError on a malformed code, and a blank plan screen is a
    // worse answer than an amount beside whatever the backend sent.
    expect(priceOf({ amount: 999, currency: "euros", interval: "month" })).toBe("9.99 EUROS");
  });
});

describe("what a plan grants", () => {
  it("is the quota over the period it is billed for", () => {
    expect(grantOf(PRO, "month")).toBe("50 relists a month");
  });

  it("reads the interval rather than assuming a month", () => {
    // A yearly Price is a thing the Stripe dashboard can create, and a card that
    // called it monthly would be off by twelve.
    expect(grantOf(PRO, "year")).toBe("50 relists a year");
    expect(grantOf(PRO, "week")).toBe("50 relists a week");
  });

  it("spells an interval it has never heard of rather than calling it a month", () => {
    expect(grantOf(PRO, "quarter")).toBe(
      "50 relists every quarter",
    );
  });

  it("agrees with the number it is describing", () => {
    expect(grantOf({ ...PRO, relistQuotaPerPeriod: 1 }, "month")).toBe("1 relist a month");
  });
});

describe("what to say when nothing opened", () => {
  it("tells a buyer their plan is gone and a free user they have nothing to manage", () => {
    // One status, two meanings — which is why the caller says which it asked.
    expect(handoffFailure({ status: "gone" }, "checkout")).toContain("on sale");
    expect(handoffFailure({ status: "gone" }, "portal")).toContain("nothing to manage");
  });

  it("says come back in a moment when Stripe could not be asked", () => {
    expect(handoffFailure({ status: "unavailable" }, "checkout")).toContain("Try again");
    expect(handoffFailure({ status: "unavailable" }, "portal")).toContain("Try again");
  });

  it("has nothing to say about a page that opened, or about a screen change", () => {
    // `signed-out` and `outdated` are screens rather than notes: the popup takes
    // them somewhere else entirely, and a note under the cards would be a second
    // account of one event.
    expect(handoffFailure({ status: "opened", url: "https://stripe.test" }, "checkout")).toBeNull();
    expect(handoffFailure({ status: "signed-out" }, "checkout")).toBeNull();
    expect(handoffFailure({ status: "outdated" }, "portal")).toBeNull();
  });
});
