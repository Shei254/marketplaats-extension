import { themeCss } from "@mprelist/ui";
import { describe, expect, it } from "vitest";

import { adminCss } from "./admin-styles";

/**
 * The same four checks `site-styles.test.ts` runs over the public surface's rules,
 * over this one's — which it did not have before the 2026-08 pass, and which is
 * how a sheet that grew a sidebar, four tiles and a media query stayed a set of
 * tokens rather than a second palette.
 */
const declared = new Set([...themeCss.matchAll(/(--mp-[\w-]+)\s*:/g)].map(([, name]) => name));
const referenced = [...adminCss.matchAll(/var\((--mp-[\w-]+)\)/g)].map(([, name]) => name);

describe("the admin corner's rules", () => {
  it("reference no custom property the design system does not declare", () => {
    // The failure this catches does not throw and does not warn: a rule reaching
    // for `--mp-stagee` renders transparent, and the sidebar is a white column on
    // a white page.
    for (const name of new Set(referenced)) {
      expect(declared, name).toContain(name);
    }
  });

  it("spell no colour of their own", () => {
    expect(adminCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it("paint the page behind the surfaces, which `.mp-root` paints as a card", () => {
    // `.mp-root` sets its own background to `--mp-bg`. These rules are later in the
    // sheet at the same specificity, which is the whole mechanism — without them
    // the sidebar, the cards and the page are one colour.
    expect(adminCss).toMatch(/\.admin-app \{[^}]*background: var\(--mp-stage\)/s);
    expect(adminCss).toMatch(/\.admin-plain \{[^}]*background: var\(--mp-stage\)/s);
    expect(adminCss).toMatch(/\.admin-sidebar \{[^}]*background: var\(--mp-bg\)/s);
  });

  it("are well-formed, since an unbalanced brace discards everything after it", () => {
    expect(adminCss.split("{")).toHaveLength(adminCss.split("}").length);
  });
});
