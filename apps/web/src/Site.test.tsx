import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Site } from "./Site";
import { BRAND } from "./brand";

const render = (pathname: string): string =>
  renderToStaticMarkup(<Site pathname={pathname} year={2026} />);

describe("what the site serves", () => {
  it("draws the success page at the path Stripe is given", () => {
    expect(render("/success")).toContain("Your payment went through");
  });

  it("draws the cancel page at its own", () => {
    expect(render("/cancel")).toContain("No payment was taken");
  });

  it("draws the billing page where the Customer Portal returns a browser", () => {
    // `apps/api` builds the Portal's `return_url` from its own copy of this path
    // (T21, #31), so an address answered "there's nothing here" would be the last
    // thing somebody sees after cancelling.
    expect(render("/billing")).toContain("That’s saved");
  });

  it("draws the privacy policy at the path the Web Store listing will carry", () => {
    // T58 (#89) cannot go up without a hosted privacy URL, and this is it.
    expect(render("/privacy")).toContain("Last updated");
    expect(render("/privacy")).toContain("only ever receive the id");
  });

  it("draws the terms at theirs", () => {
    expect(render("/terms")).toContain("the original ad is deleted");
  });

  it("draws the not-found page everywhere else, including the root", () => {
    expect(render("/")).toContain("There’s nothing at this address");
    expect(render("/whatever")).toContain("There’s nothing at this address");
  });
});

describe("the frame", () => {
  const markup = render("/success");

  it("carries the design system's sheet and this surface's rules, in that order", () => {
    // Both are strings injected as `<style>`, which is the one form that also
    // adopts into a shadow root — the arrangement `packages/ui` chose and the
    // reason there is no CSS pipeline in either build.
    expect(markup.indexOf(".mp-root {")).toBeGreaterThan(-1);
    expect(markup.indexOf(".web-stage {")).toBeGreaterThan(markup.indexOf(".mp-root {"));
  });

  it("names the product once in the header and once in the footer", () => {
    expect(markup).toContain(`© 2026 ${BRAND.name}`);
    expect(markup).toContain('class="web-brand"');
  });

  it("links to both documents and to the support address, and to nothing else", () => {
    // Five links on the whole site: Privacy and Terms in the header, the same two
    // and the support address in the footer. They arrived with T36 (#45), the
    // ticket that wrote the pages — a link to an address answered with "there's
    // nothing at this address" is worse than one that arrives with its page.
    expect(markup).toContain(`href="mailto:${BRAND.supportEmail}"`);
    expect([...markup.matchAll(/href="\/privacy"/g)]).toHaveLength(2);
    expect([...markup.matchAll(/href="\/terms"/g)]).toHaveLength(2);
    expect([...markup.matchAll(/<a\b/g)]).toHaveLength(5);
  });

  it("marks the document being read rather than linking it to itself", () => {
    // `aria-current` is what a screen reader announces and what the stylesheet
    // hangs the canvas's emphasis off — one fact rather than two spellings of it.
    const reading = render("/privacy");

    expect(reading).toContain('href="/privacy" aria-current="page"');
    expect(reading).not.toContain('href="/terms" aria-current="page"');
  });

  it("draws a document as a document, not as one centred sentence", () => {
    expect(render("/terms")).toContain('class="web-doc"');
    expect(render("/success")).not.toContain('class="web-doc"');
  });
});
