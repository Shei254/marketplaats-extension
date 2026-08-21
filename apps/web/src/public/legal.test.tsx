import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BRAND } from "../brand";
import { PRIVACY, PrivacyPage, TERMS, TermsPage } from "./legal";

/**
 * Privacy and terms (T36, #45).
 *
 * What is asserted is not the prose — it is the canvas's and a lawyer's to change
 * — but the four things about these pages that would be *wrong* rather than
 * merely different: that they say the destructive thing, that they say they are
 * not a lawyer's work, that they promise nothing the schema cannot keep, and that
 * they ask the reader for nothing (ADR-0017).
 */
const PAGES = { privacy: <PrivacyPage />, terms: <TermsPage /> };

describe("the terms", () => {
  const markup = renderToStaticMarkup(PAGES.terms);

  it("say the original ad is deleted, in those words", () => {
    // The most important sentence in the product (ADR-0002/0003). A terms page for
    // a delete-and-recreate tool that buried this would be the one piece of copy
    // it is not acceptable to get wrong.
    expect(markup).toContain("the original ad is deleted");
    expect(markup).toContain("Do not relist an ad you cannot afford to lose");
  });

  it("say what happens when a paid plan ends, which is not a lockout", () => {
    // ADR-0018: a lapsed subscription falls back to the default tier. "You are
    // never locked out of your own ads" is behaviour, not reassurance.
    expect(markup).toContain("drop back to the free plan");
    expect(markup).toContain("never locked out");
  });

  it("do not promise Marktplaats will not object", () => {
    // ADR-0008 is explicit that pacing reduces the risk and cannot remove it, and
    // this is the page where that has to be said out loud rather than implied.
    expect(markup).toContain("cannot promise Marktplaats will not object");
  });
});

describe("the privacy policy", () => {
  const markup = renderToStaticMarkup(PAGES.privacy);

  it("says the ad never reaches us, which is the boundary the whole design keeps", () => {
    // ADR-0001/0005: the relist runs in the user's own browser under their own
    // Marktplaats session, and the only thing our API is ever told about an ad is
    // its id (#22). This page is where that promise is made in public.
    expect(markup).toContain("never reach us");
    expect(markup).toContain("only ever receive the id");
  });

  it("says card details go to Stripe rather than to us", () => {
    expect(markup).toContain("straight to Stripe");
  });

  it("claims no analytics, because there is none to claim", () => {
    expect(markup).toContain("no analytics or advertising code");
  });
});

describe("both documents", () => {
  for (const [name, page] of Object.entries(PAGES)) {
    describe(name, () => {
      const markup = renderToStaticMarkup(page);

      it("says on its face that it is not a lawyer's work", () => {
        // Rendered rather than left in a comment: the page is public from the day
        // it deploys, and somebody has to be able to tell that it is a draft
        // without reading the repository. T58 (#89) is where it stops being one.
        expect(markup).toContain("[PLACEHOLDER]");
        expect(markup).toContain("needs a lawyer");
      });

      it("calls the product what brand.json calls it", () => {
        expect(markup).toContain(BRAND.name);
      });

      it("asks the reader for nothing", () => {
        // ADR-0017 again, and it matters most here: a privacy policy behind a sign-in
        // is a privacy policy the Web Store reviewer cannot read.
        expect(markup).not.toMatch(/<(form|input|button|label)\b/);
        expect(markup.toLowerCase()).not.toMatch(/sign in|log in/);
      });

      it("carries every section the canvas draws, in order", () => {
        const document = name === "privacy" ? PRIVACY : TERMS;
        const positions = document.sections.map((section) => markup.indexOf(section.heading));

        expect(positions.every((at) => at > -1)).toBe(true);
        expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
      });
    });
  }
});
