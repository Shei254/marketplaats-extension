import { componentCss, themeCss } from "@mprelist/ui";
import { describe, expect, it } from "vitest";

import { loginCss } from "./css";

const declared = new Set([...themeCss.matchAll(/(--mp-[\w-]+)\s*:/g)].map(([, name]) => name));
const referenced = [...loginCss.matchAll(/var\((--mp-[\w-]+)\)/g)].map(([, name]) => name);

describe("the login page's own rules", () => {
  it("reference no custom property the design system does not declare", () => {
    for (const name of new Set(referenced)) {
      expect(declared, name).toContain(name);
    }
  });

  it("spell no colour of their own", () => {
    // The two glyph masks are exempt and are not an exception to the rule: a
    // mask reads a pixel's alpha and never its colour, which is why they are
    // drawn in `currentColor` and have no value to get wrong. Stripping them
    // keeps the assertion below exact rather than loosening it.
    const withoutMasks = loginCss.replace(/mask-image:[^;]+;/g, "");
    expect(withoutMasks).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it("paint the page behind the card, which is the surface a login page is", () => {
    expect(loginCss).toMatch(/\.login-stage \{[^}]*background: var\(--mp-stage\)/s);
  });

  it("redescribe no control the design system already draws", () => {
    // Keycloak's markup is given `mp-…` classes by `theme.properties`, so the
    // button on this page *is* the design system's button rather than one that
    // looks like it. A rule whose whole subject is one of them would be this
    // theme quietly forking the sheet. Placing one inside a layout of this page's
    // own — `.login-input-group .mp-input` — is not that, and is what `apps/web`
    // does to `.mp-mark` for the same reason.
    for (const name of ["mp-btn", "mp-input", "mp-label", "mp-card", "mp-note", "mp-field"]) {
      expect(loginCss, name).not.toMatch(new RegExp(`^\\.${name}\\b[^{]*\\{`, "m"));
    }
    // And the sheet it defers to has to be the one that defines them, or the
    // hooks in `theme.properties` name classes that style nothing at all — which
    // renders as Keycloak's markup with no design at all rather than loudly.
    for (const name of ["mp-btn", "mp-input", "mp-label", "mp-card", "mp-check", "mp-field"]) {
      expect(componentCss, name).toMatch(new RegExp(`^\\.${name}\\b\\s*[,{]`, "m"));
    }
  });

  it("are well-formed, since an unbalanced brace discards everything after it", () => {
    expect(loginCss.split("{")).toHaveLength(loginCss.split("}").length);
  });
});
