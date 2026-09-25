import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BRAND } from "../brand";
import { PRIVACY, PrivacyPage, TERMS, TermsPage } from "./legal";

/**
 * Privacy and terms (T36, #45).
 *
 * The privacy page's prose is not asserted — it is the canvas's to change — only
 * the three things about it that would be *wrong* rather than merely different:
 * that it promises nothing the schema cannot keep, that the terms beside it say
 * the destructive thing, and that neither asks the reader for anything (ADR-0017).
 *
 * **The terms' prose *is* asserted**, and has to be: it is the operator's own
 * Gebruiksvoorwaarden rather than a description this repo may reword, so the
 * clauses that carry a legal obligation are quoted here. A section that quietly
 * went missing in an edit is the failure these particular tests exist to catch.
 */
const PAGES = { privacy: <PrivacyPage />, terms: <TermsPage /> };

describe("the terms", () => {
  const markup = renderToStaticMarkup(PAGES.terms);

  it("say the original ad is deleted, in those words", () => {
    // The most important sentence in the product (ADR-0002/0003). A terms page for
    // a delete-and-recreate tool that buried this would be the one piece of copy
    // it is not acceptable to get wrong.
    expect(markup).toContain("de oorspronkelijke advertentie wordt verwijderd");
    expect(markup).toContain("Herplaats geen advertentie die je niet kwijt kunt");
  });

  it("say what happens when a paid plan ends, which is not a lockout", () => {
    // ADR-0018: a lapsed subscription falls back to the default tier. "You are
    // nooit buitengesloten from your own ads" is behaviour, not reassurance.
    //
    // This survives in a section that names **no way to cancel**, deliberately:
    // cancelling is the operator's own copy to describe and it describes it
    // differently, so a section that said it twice would be a terms page
    // contradicting itself. What is here is only what a plan grants and what
    // becomes of it — facts the operator's text leaves out and does not touch.
    expect(markup).toContain("terug naar het gratis abonnement");
    expect(markup).toContain("nooit buitengesloten");
  });

  it("state the quota a plan grants, and that it does not carry over", () => {
    expect(markup).toContain("een aantal herplaatsingen per maand");
    expect(markup).toContain("gaan niet mee naar de volgende periode");
  });

  it("bill a paying customer at the rhythm they bought, not monthly regardless", () => {
    // T87, ADR-0037: a plan is sold per maand and per jaar, and what changes
    // between the two is the price and the billing, never the grant.
    expect(markup).toContain("per maand of per jaar gefactureerd");
    expect(markup).not.toContain("automatisch per maand gefactureerd");
  });

  it("do not promise Marktplaats will not object", () => {
    // ADR-0008 is explicit that pacing reduces the risk and cannot remove it, and
    // this is the page where that has to be said out loud rather than implied.
    expect(markup).toContain("kan niet beloven dat Marktplaats er geen bezwaar tegen maakt");
  });

  it("carry the clauses that are about the agreement rather than about the product", () => {
    // What arrived with the full Gebruiksvoorwaarden: the parts a terms page needs
    // and an honest product description never supplies on its own — that reading it
    // binds you, that the liability is capped, and that a consumer has fourteen days.
    expect(markup).toContain("erken je dat je deze gebruiksvoorwaarden hebt gelezen en begrepen");
    expect(markup).toContain("zonder enige uitdrukkelijke of impliciete garantie");
    expect(markup).toContain("herroepingsrecht van 14 dagen");
  });

  it("disclaim Marktplaats, which is the sentence the Web Store reviewer looks for", () => {
    // T58 (#89): the listing names Marktplaats in the copy, so the page it links to
    // has to say the relationship is none. Store policy on trademarks turns on it.
    expect(markup).toContain("niet gelieerd aan of gecertificeerd door Marktplaats");
    expect(markup).toContain("geregistreerd handelsmerk");
  });

  it("name the support address everywhere the source text said EMAIL", () => {
    // Three places invite the reader to write to us — deleting an account, a
    // dispute, and exercising the herroepingsrecht. The address is brand.json's, as
    // the name is: a document that spelled it would be a second copy to forget.
    expect(markup.split(BRAND.supportEmail)).toHaveLength(4);
    expect(markup).not.toContain("EMAIL");
  });

  it("set out the grounds for termination as a list, because the source enumerates them", () => {
    // Four grounds, each its own item. A section model that could only hold one
    // paragraph would have run them together into a sentence with semicolons.
    expect(markup).toContain('<ul class="web-doc-list">');
    expect(markup.match(/<li>/g)).toHaveLength(4);
    expect(markup).toContain("Het uitvoeren van frauduleuze of illegale activiteiten");
  });
});

describe("the privacy policy", () => {
  const markup = renderToStaticMarkup(PAGES.privacy);

  it("says the ad never reaches us, which is the boundary the whole design keeps", () => {
    // ADR-0001/0005: the relist runs in the user's own browser under their own
    // Marktplaats session, and the only thing our API is ever told about an ad is
    // its id (#22). This page is where that promise is made in public.
    expect(markup).toContain("bereiken ons nooit");
    expect(markup).toContain("ontvangen alleen het id");
  });

  it("says payment details go to Stripe rather than to us, without saying card", () => {
    // Naming Stripe stays: it is what appears on the buyer's bank statement, and a
    // policy that hid its processor would be the worse document. What changed in
    // T64 is "card details" — iDEAL, SEPA and PayPal are all offered, so describing
    // only cards describes a minority of the payments this product takes.
    expect(markup).toContain("rechtstreeks naar Stripe");
    expect(markup).not.toContain("Card details");
  });

  it("claims no analytics, because there is none to claim", () => {
    expect(markup).toContain("geen analyse- of advertentiecode");
  });
});

describe("both documents", () => {
  for (const [name, page] of Object.entries(PAGES)) {
    describe(name, () => {
      const markup = renderToStaticMarkup(page);

      it("calls the product what brand.json calls it", () => {
        expect(markup).toContain(BRAND.name);
      });

      it("asks the reader for nothing", () => {
        // ADR-0017 again, and it matters most here: a privacy policy behind a sign-in
        // is a privacy policy the Web Store reviewer cannot read.
        expect(markup).not.toMatch(/<(form|input|button|label)\b/);
        expect(markup.toLowerCase()).not.toMatch(/sign in|log in/);
      });

      it("carries every section of the document, in order", () => {
        const document = name === "privacy" ? PRIVACY : TERMS;
        const positions = document.sections.map((section) => markup.indexOf(section.heading));

        expect(positions.every((at) => at > -1)).toBe(true);
        expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
      });
    });
  }
});
