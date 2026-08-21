import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BRAND } from "../brand";
import { CancelPage, NotFoundPage, SuccessPage } from "./pages";

const PAGES = { success: <SuccessPage />, cancel: <CancelPage />, "not-found": <NotFoundPage /> };

describe("the success page", () => {
  const markup = renderToStaticMarkup(PAGES.success);

  it("says the payment landed, and that the thing they bought is in the toolbar", () => {
    // The webhook (T20, #30) is what moves the subscription; this page's whole job
    // is to catch a browser Stripe redirected and point it back at the extension.
    expect(markup).toContain("Your payment went through");
    expect(markup).toContain("icon in your toolbar");
  });

  it("calls the product what brand.json calls it", () => {
    expect(markup).toContain(BRAND.name);
  });
});

describe("the cancel page", () => {
  const markup = renderToStaticMarkup(PAGES.cancel);

  it("says nothing was charged and nothing changed", () => {
    // Somebody who backed out of Checkout is being told they still have what they
    // had, which is true: cancelling a Checkout session changes no subscription.
    expect(markup).toContain("nothing was charged and nothing changed");
    expect(markup).toContain("Your free relists are still there");
  });

  it("does not congratulate anybody", () => {
    expect(markup).not.toContain("all set");
  });
});

describe("the not-found page", () => {
  const markup = renderToStaticMarkup(PAGES["not-found"]);

  it("sends a visitor to the toolbar rather than apologising", () => {
    expect(markup).toContain("icon in your toolbar");
  });

  it("does not tell somebody who just paid that anything went wrong", () => {
    // A mistyped URL after a payment is the likeliest way anyone reaches this.
    expect(markup).toContain("the payment landed");
  });
});

describe("every public page", () => {
  for (const [name, page] of Object.entries(PAGES)) {
    describe(name, () => {
      const markup = renderToStaticMarkup(page);

      it("asks the visitor for nothing", () => {
        // ADR-0017: the public routes never learn who anybody is. A field is the
        // shape that question would take, so there is not one on any of them.
        expect(markup).not.toMatch(/<(form|input|button|label)\b/);
      });

      it("offers no way to sign in", () => {
        expect(markup.toLowerCase()).not.toMatch(/sign in|log in|create an account/);
      });

      it("links nowhere at all", () => {
        // The only link on this site is the support address in the frame. A page
        // that linked out would be a page with something to click on, and the one
        // thing these say is that the product is somewhere else.
        expect(markup).not.toContain("<a ");
      });
    });
  }
});
