import { describe, expect, it } from "vitest";

import { isQuota } from "./quota";

/**
 * What a quota may say on the wire (T73, ADR-0029), held here because five parsers
 * across two clients had written the rule out five times.
 *
 * The cases below are not a survey of a number checker. Each one is a value the API
 * can send or a reader can be handed, and three of them are the states the ADR
 * exists to keep apart: `null` is a tier with no cap, `0` is a tier that grants
 * nothing, and `-1` is the sentinel the ADR rejected — a parser that let it through
 * would be readmitting it one layer below the decision.
 */
describe("a quota, as this API sends one", () => {
  it("is a whole number that is not negative", () => {
    expect(isQuota(3)).toBe(true);
    expect(isQuota(1)).toBe(true);
    expect(isQuota(9999)).toBe(true);
  });

  it("and `null`, which is a tier with no cap rather than a hole in the body", () => {
    // A parser that refused this would render "unavailable" to the users on the
    // most generous plan in the catalog.
    expect(isQuota(null)).toBe(true);
  });

  it("and `0`, which is a tier that grants nothing and is not the same as no cap", () => {
    // The pair ADR-0029 turns on. Zero is a value an operator chose.
    expect(isQuota(0)).toBe(true);
  });

  it("but never `-1`, which is the sentinel the ADR refused", () => {
    // `Math.max(0, -1 - held)` is 0, so the most generous tier would refuse every
    // repost while reading as a working gate. It is not a quota, at any layer.
    expect(isQuota(-1)).toBe(false);
    expect(isQuota(-50)).toBe(false);
  });

  it("and never `undefined`, because absent is not the same as null here", () => {
    // The distinction the write side spends a `JsonNode` on, kept on the read side
    // too: a body that omits the field is a body this could not read.
    expect(isQuota(undefined)).toBe(false);
  });

  it("and nothing that merely looks like a number", () => {
    expect(isQuota("3")).toBe(false);
    expect(isQuota(2.5)).toBe(false);
    expect(isQuota(Number.NaN)).toBe(false);
    expect(isQuota(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isQuota(true)).toBe(false);
    expect(isQuota({})).toBe(false);
    expect(isQuota([])).toBe(false);
  });
});
