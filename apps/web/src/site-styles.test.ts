import { themeCss } from "@mprelist/ui";
import { describe, expect, it } from "vitest";

import { siteCss } from "./site-styles";

const declared = new Set([...themeCss.matchAll(/(--mp-[\w-]+)\s*:/g)].map(([, name]) => name));
const referenced = [...siteCss.matchAll(/var\((--mp-[\w-]+)\)/g)].map(([, name]) => name);

describe("this surface's rules", () => {
  it("reference no custom property the design system does not declare", () => {
    // The same test `packages/ui` runs over its own rules, for the same failure:
    // a rule reaching for `--mp-stagee` does not throw and does not warn. It
    // renders transparent, and the card is a white box on a white page.
    for (const name of new Set(referenced)) {
      expect(declared, name).toContain(name);
    }
  });

  it("spell no colour of their own", () => {
    expect(siteCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it("paint the page behind the card, which is the one surface that shows the stage", () => {
    // `.mp-root` paints itself `--mp-bg`. Without this the card would be the same
    // colour as the page and the whole layout would be invisible.
    expect(siteCss).toMatch(/\.web-stage \{[^}]*background: var\(--mp-stage\)/s);
    expect(siteCss).toMatch(/\.web-card \{[^}]*background: var\(--mp-bg\)/s);
  });

  it("are well-formed, since an unbalanced brace discards everything after it", () => {
    expect(siteCss.split("{")).toHaveLength(siteCss.split("}").length);
  });
});
