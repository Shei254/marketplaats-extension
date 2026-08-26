import { describe, expect, it } from "vitest";

import { tierCodeFrom } from "./tier-code";

/**
 * The derivation an operator no longer does by hand. It is held to the shape the
 * API and Stripe both take, because a code that gets past this function is one
 * nothing downstream will refuse for its spelling.
 */
describe("the code a plan is filed under", () => {
  it("is the name, lower case", () => {
    expect(tierCodeFrom("Pro")).toBe("pro");
  });

  it("joins the words of a name with one hyphen", () => {
    expect(tierCodeFrom("Pro Plus")).toBe("pro-plus");
    expect(tierCodeFrom("Power   Seller")).toBe("power-seller");
  });

  it("folds an accent rather than dropping the letter under it", () => {
    // Without the normalise this is `pr-`, which is a plan filed under a stub.
    expect(tierCodeFrom("Pró")).toBe("pro");
    expect(tierCodeFrom("Zakelijk Groeiën")).toBe("zakelijk-groeien");
  });

  it("keeps digits, which is most of how plans are told apart", () => {
    expect(tierCodeFrom("Team 20")).toBe("team-20");
  });

  it("collapses punctuation instead of spelling it", () => {
    expect(tierCodeFrom("Pro — Annual")).toBe("pro-annual");
    expect(tierCodeFrom("  Power!  ")).toBe("power");
    expect(tierCodeFrom("Pro / Plus")).toBe("pro-plus");
  });

  it("answers empty for a name that has nothing in it to make a code from", () => {
    // A real answer rather than a throw: the form says so, and asks for a name
    // with a letter in it. Sending it would be sending `""` to an API that
    // refuses blanks — a round trip to be told what is visible here.
    expect(tierCodeFrom("!!!")).toBe("");
    expect(tierCodeFrom("   ")).toBe("");
    expect(tierCodeFrom("")).toBe("");
  });

  it("is stable under itself, so a code is never re-derived into a different one", () => {
    for (const name of ["Pro", "Pro Plus", "Team 20", "Pró — Annual"]) {
      expect(tierCodeFrom(tierCodeFrom(name))).toBe(tierCodeFrom(name));
    }
  });

  it("produces nothing the API or Stripe would refuse for its spelling", () => {
    for (const name of ["Pro Plus", "Team 20", "Pró", "Zakelijk €99", "a".repeat(40)]) {
      expect(tierCodeFrom(name), name).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
