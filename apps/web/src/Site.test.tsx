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

  it("offers the support address and nothing else to click", () => {
    // Privacy and terms are T36 (#45). The canvas draws links to them here; a link
    // to a page that answers "there's nothing at this address" is worse than one
    // that arrives with the page.
    expect(markup).toContain(`href="mailto:${BRAND.supportEmail}"`);
    expect([...markup.matchAll(/<a\b/g)]).toHaveLength(1);
  });
});
