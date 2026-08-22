import { describe, expect, it } from "vitest";

import { ALL, MIN_QUERY_LENGTH, noMatches, sameShowing, showingFor } from "./searching";

/**
 * What a box holding a string is asking for (T31, #40).
 *
 * The rules are two and both are about *not* searching: under two characters
 * there is nothing worth a request, and whitespace is not a character. The
 * debounce is the third and is a property of typing rather than of a string, so
 * it is asserted where somebody types — `Popup.test.tsx`.
 */
describe("what the box is asking for", () => {
  it("is a search once it says enough to be one", () => {
    expect(showingFor("fi")).toEqual({ kind: "search", query: "fi" });
    expect(MIN_QUERY_LENGTH).toBe(2);
  });

  it("is the whole list under the minimum, which is what clearing it means", () => {
    // One letter matches most of an account, so searching for it is a request
    // whose answer nobody wanted.
    expect(showingFor("")).toEqual(ALL);
    expect(showingFor("f")).toEqual(ALL);
  });

  it("does not count spaces towards it, or keep them in the query", () => {
    // `" "` would otherwise be a whole-account search dressed as a filter, and
    // "fiets " a second query for the same word.
    expect(showingFor("  ")).toEqual(ALL);
    expect(showingFor(" f ")).toEqual(ALL);
    expect(showingFor(" fiets ")).toEqual({ kind: "search", query: "fiets" });
  });
});

describe("whether two of them are the same question", () => {
  it("holds for the same query and for the whole list twice", () => {
    expect(sameShowing(ALL, ALL)).toBe(true);
    expect(sameShowing({ kind: "search", query: "fiets" }, { kind: "search", query: "fiets" })).toBe(
      true,
    );
  });

  it("and never across the two kinds", () => {
    expect(sameShowing(ALL, { kind: "search", query: "fiets" })).toBe(false);
    expect(sameShowing({ kind: "search", query: "fiets" }, { kind: "search", query: "fiet" })).toBe(
      false,
    );
  });
});

describe("an empty answer", () => {
  it("says what did not match, rather than that the account is empty", () => {
    // The distinction the `empty` prop exists for: an account with no ads and a
    // search that found none are the same three states and two different facts.
    expect(noMatches("fiets")).toContain("fiets");
    expect(noMatches("fiets")).not.toContain("no active ads");
  });
});
