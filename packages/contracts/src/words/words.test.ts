import { describe, expect, it } from "vitest";

import type { Plan } from "../enforcement";
import {
  dayOf,
  dueToday,
  freshPeriodLine,
  grantOf,
  priceAndRhythmOf,
  unlimitedReposts,
  waysToPay,
} from "../wording";
import { keyPaths } from "./catalog";
import { en } from "./en";
import { nl } from "./nl";

const PRO: Plan = {
  tier: { code: "pro", name: "Pro" },
  relistQuotaPerPeriod: 50,
  features: {},
  prices: [{ amount: 999, currency: "eur", interval: "month" }],
};

describe("the key paths of a catalog", () => {
  it("names every leaf by its dotted path, arrays by index", () => {
    expect(keyPaths({ a: "x", b: { c: "y", d: ["p", ["q", "r"]] } })).toEqual([
      "a",
      "b.c",
      "b.d.0",
      "b.d.1.0",
      "b.d.1.1",
    ]);
  });
});

describe("the plan sentences in English", () => {
  it("have exactly the Dutch catalog's keys", () => {
    // The type check holds the shape; this holds what a type cannot see — a key
    // the English has and the Dutch never asked for.
    expect(keyPaths(en)).toEqual(keyPaths(nl));
  });

  it("say repost for herplaatsen", () => {
    expect(grantOf(PRO, "en")).toBe("50 reposts a month");
    expect(grantOf({ ...PRO, relistQuotaPerPeriod: 1 }, "en")).toBe("1 repost a month");
    expect(unlimitedReposts("en")).toBe("Unlimited reposts");
  });

  it("write money the Dutch way inside an English sentence", () => {
    // ADR-0043: these are amounts on a Dutch marketplace, in either Language.
    expect(priceAndRhythmOf({ amount: 999, currency: "eur", interval: "month" }, "en")).toMatch(
      /^€\s9,99 a month$/,
    );
    expect(dueToday({ amount: 1250, currency: "eur" }, "en")).toMatch(/12,50/);
  });

  it("date in the Language", () => {
    expect(dayOf("2026-12-12T12:00:00Z", "en")).toBe("12 December");
    expect(dayOf("2026-12-12T12:00:00Z", "nl")).toBe("12 december");
  });

  it("leave a tier's name and a payment brand as they are", () => {
    expect(waysToPay(["ideal", "card"], "en")).toBe("You can pay with iDEAL or credit card.");
    expect(freshPeriodLine({ relistQuotaPerPeriod: 50 }, { name: "Basis", relistQuotaPerPeriod: 10 }, "en")).toBe(
      "Your new month starts today with 50 reposts; what is left of Basis expires.",
    );
  });

  it("leave the Dutch as it was", () => {
    expect(grantOf(PRO)).toBe("50 herplaatsingen per maand");
    expect(grantOf(PRO, "nl")).toBe("50 herplaatsingen per maand");
  });
});
