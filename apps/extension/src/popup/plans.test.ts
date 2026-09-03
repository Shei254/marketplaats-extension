import type { Plan } from "@mprelist/contracts";
import { describe, expect, it } from "vitest";

import { grantOf, handoffFailure, priceOf, waysToPay } from "./plans";

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

  /**
   * The smallest unit is the currency's own, not a hundredth (T66).
   *
   * This card used to divide by a hundred, which is right for a euro and wrong for
   * every currency without cents — ¥1200 rendered as ¥12 on the screen somebody
   * decides to pay from. The conversion is the contract's now, and `/admin` writes
   * amounts through the same module, so what an operator prices and what a buyer
   * reads cannot disagree about what the number means.
   */
  it("counts in the currency's own smallest unit rather than in hundredths", () => {
    expect(priceOf({ amount: 1200, currency: "jpy", interval: "month" })).toMatch(/1\.200/);
    expect(priceOf({ amount: 1200, currency: "jpy", interval: "month" })).not.toMatch(/12,00/);
  });

  it("including on the fallback, where the amount is spelled out beside its code", () => {
    expect(priceOf({ amount: 1200, currency: "jpyy", interval: "month" })).toBe("12.00 JPYY");
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

describe("what a buyer can pay with", () => {
  it("leads with iDEAL, because this is a Dutch marketplace", () => {
    // ADR-0006 chose Stripe over a card-only arrangement precisely to keep iDEAL,
    // and the order here is what that decision buys at the moment somebody is
    // deciding. Stripe's own order is alphabetical and would bury it under `card`.
    expect(waysToPay(["card", "paypal", "ideal"])).toBe("Pay with iDEAL, PayPal or card.");
  });

  it("joins two with `or` and one with neither", () => {
    expect(waysToPay(["card", "ideal"])).toBe("Pay with iDEAL or card.");
    expect(waysToPay(["ideal"])).toBe("Pay with iDEAL.");
  });

  it("says nothing at all rather than an empty sentence", () => {
    // Both of these render no line: Stripe could not be asked, or it offers only
    // things this popup has no name for. "Pay with ." is not a sentence, and the
    // cards beside it are unaffected either way (T65, #137).
    expect(waysToPay([])).toBeNull();
    expect(waysToPay(["twint", "swish"])).toBeNull();
  });

  it("drops a method it has no name for rather than showing Stripe's token", () => {
    // A deliberate departure from `grantOf` and `priceOf`, which render what Stripe
    // spelled. Their alternative was mistranslation — an unknown interval called "a
    // month" is a lie about money. Here it is silence, and "or sepa_debit" in the
    // one line meant to reassure is worse than absent. The API logs the whole
    // offered set on refresh, so the gap is visible where the operator is.
    expect(waysToPay(["ideal", "twint", "card"])).toBe("Pay with iDEAL or card.");
  });

  it("leaves the wallets out, which is what keeps the sentence non-exhaustive", () => {
    // `link`, `apple_pay` and `google_pay` are usually on and are not what somebody
    // hesitating over a subscription is looking for. Omitting a method never makes
    // the sentence false; only naming one that is off would.
    expect(waysToPay(["card", "link", "apple_pay", "google_pay"])).toBe("Pay with card.");
  });

  it("names SEPA and Bancontact when they are on, in the order it says them", () => {
    // SEPA and Bancontact sort last, so this is also the check that they are named
    // rather than quietly dropped for arriving late in `WAYS_TO_PAY`.
    expect(waysToPay(["sepa_debit", "bancontact", "ideal"])).toBe(
      "Pay with iDEAL, Bancontact or SEPA Direct Debit.",
    );
  });

  it("names every method it can spell, rather than truncating to the first few", () => {
    // Everything a Dutch account can turn on. ADR-0022 weighed a fixed three-name
    // line as its option 1 and rejected it, because a sentence written here drifts
    // from the dashboard. Truncating what Stripe returns would reinstate that drift
    // by a side door: the popup would again be holding an opinion about which of
    // the enabled methods are worth naming.
    expect(waysToPay(["ideal", "paypal", "card", "bancontact", "sepa_debit"])).toBe(
      "Pay with iDEAL, PayPal, card, Bancontact or SEPA Direct Debit.",
    );
  });

  it("and the order is what does the editing, not the length", () => {
    // No PayPal on this account. `WAYS_TO_PAY`'s order decides how the sentence
    // reads and its membership decides what may appear at all — neither is
    // positional, so nothing falls off the end.
    expect(waysToPay(["ideal", "card", "bancontact", "sepa_debit"])).toBe(
      "Pay with iDEAL, card, Bancontact or SEPA Direct Debit.",
    );
  });

  it("says exactly what the slice C click-through script expects of it", () => {
    // `docs/click-through.md` step 3a is the manual gate ADR-0016 closes slice C on,
    // and step 4 then checks these are the same names Checkout offers. The four are
    // what T22 keeps ticked in the dashboard, and a truncating cap would break this.
    expect(waysToPay(["ideal", "paypal", "card", "sepa_debit"])).toBe(
      "Pay with iDEAL, PayPal, card or SEPA Direct Debit.",
    );
  });
});
