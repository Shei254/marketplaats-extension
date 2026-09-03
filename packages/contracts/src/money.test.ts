import { describe, expect, it } from "vitest";

import { amountInMinorUnits, decimalsIn, inMajorUnits, majorUnitsOf } from "./money";

describe("what a currency's smallest unit is", () => {
  it("is a hundredth for the ones this catalog is priced in", () => {
    expect(decimalsIn("eur")).toBe(2);
    expect(decimalsIn("usd")).toBe(2);
  });

  it("and is asked of Intl rather than assumed", () => {
    // The reason this is not `* 100`: a yen has no cents and a dinar has three
    // decimal places, so a hardcoded hundred is a plan priced a hundred times
    // wrong in the two accounts that would notice.
    expect(decimalsIn("jpy")).toBe(0);
    expect(decimalsIn("kwd")).toBe(3);
  });

  it("and falls back to a hundredth for a code Intl will not take", () => {
    expect(decimalsIn("")).toBe(2);
    expect(decimalsIn("euro")).toBe(2);
  });
});

describe("an amount typed the way money is written", () => {
  it("becomes the smallest unit Stripe counts in", () => {
    expect(amountInMinorUnits("10.00", "eur")).toBe(1000);
    expect(amountInMinorUnits("9.99", "eur")).toBe(999);
    expect(amountInMinorUnits("0.50", "eur")).toBe(50);
  });

  it("without needing every decimal place typed", () => {
    expect(amountInMinorUnits("10", "eur")).toBe(1000);
    expect(amountInMinorUnits("10.5", "eur")).toBe(1050);
    expect(amountInMinorUnits("10.", "eur")).toBe(1000);
  });

  it("and reads a comma as the separator, because that is how a Dutch operator types it", () => {
    expect(amountInMinorUnits("9,99", "eur")).toBe(999);
  });

  it("is zero when zero is what was typed, which is a price Stripe will hold", () => {
    expect(amountInMinorUnits("0", "eur")).toBe(0);
    expect(amountInMinorUnits("0.00", "eur")).toBe(0);
  });

  it("counts by the currency's own places rather than by a hundred", () => {
    expect(amountInMinorUnits("1200", "jpy")).toBe(1200);
    expect(amountInMinorUnits("10.500", "kwd")).toBe(10500);
  });

  it("refuses more decimal places than the currency has, rather than rounding money away", () => {
    // Silently dropping a digit is charging an amount nobody typed. Better to say
    // so on the form than to create an immutable Stripe Price from a guess.
    expect(amountInMinorUnits("9.999", "eur")).toBeNull();
    expect(amountInMinorUnits("100.5", "jpy")).toBeNull();
  });

  it("and refuses anything that is not an amount", () => {
    expect(amountInMinorUnits("", "eur")).toBeNull();
    expect(amountInMinorUnits("   ", "eur")).toBeNull();
    expect(amountInMinorUnits("-1.00", "eur")).toBeNull();
    expect(amountInMinorUnits("ten", "eur")).toBeNull();
    expect(amountInMinorUnits("1.2.3", "eur")).toBeNull();
    expect(amountInMinorUnits("1e3", "eur")).toBeNull();
  });

  it("and does not lose a cent to floating point on the way", () => {
    // `Math.round(4.35 * 100)` is 434. The digits are read as digits for that
    // reason, and the suite pins it because the failure is one cent, silently.
    expect(amountInMinorUnits("4.35", "eur")).toBe(435);
    expect(amountInMinorUnits("1.005", "kwd")).toBe(1005);
    expect(amountInMinorUnits("8.165", "kwd")).toBe(8165);
  });
});

describe("an amount Stripe reported, written back the way money is", () => {
  it("carries the currency's own places", () => {
    expect(inMajorUnits(999, "eur")).toBe("9.99");
    expect(inMajorUnits(1000, "eur")).toBe("10.00");
    expect(inMajorUnits(1200, "jpy")).toBe("1200");
    expect(inMajorUnits(10500, "kwd")).toBe("10.500");
  });
});

describe("an amount handed to whatever is going to format it", () => {
  it("is the major units, which is what Intl formats", () => {
    expect(majorUnitsOf(999, "eur")).toBe(9.99);
    expect(majorUnitsOf(1000, "eur")).toBe(10);
  });

  it("counted by the currency's own places rather than by a hundred", () => {
    // The bug this replaces: a yen has no minor unit, so `/ 100` renders ¥1,200 as
    // ¥12 on a card somebody is deciding to pay from.
    expect(majorUnitsOf(1200, "jpy")).toBe(1200);
    expect(majorUnitsOf(10500, "kwd")).toBe(10.5);
  });

  it("and formats through Intl the way a plan card shows it", () => {
    const shown = (minor: number, currency: string): string =>
      new Intl.NumberFormat("nl-NL", { style: "currency", currency: currency.toUpperCase() })
        .format(majorUnitsOf(minor, currency))
        .replace(/\u00a0/g, " ");

    expect(shown(999, "eur")).toBe("€ 9,99");
    // `JP¥` is what a Dutch locale calls a yen, and is `Intl`'s business rather
    // than this module's — what is pinned here is the 1.200, not the symbol.
    expect(shown(1200, "jpy")).toBe("JP¥ 1.200");
  });
});
