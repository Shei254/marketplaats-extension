import { palette, radius, space, text } from "@mprelist/ui";
import { describe, expect, it } from "vitest";

import {
  asideStyle,
  buttonRowStyle,
  buttonStyle,
  paragraphStyle,
  signatureStyle,
  STYLES,
  urlStyle,
} from "./styles";

const every = [
  ...Object.values(STYLES),
  paragraphStyle,
  asideStyle,
  signatureStyle,
  urlStyle,
  buttonStyle,
  buttonRowStyle,
];

const values = new Set(Object.values(palette.light));

describe("the mail's styling", () => {
  it("spells no colour of its own", () => {
    // The mirror of `css.test.ts`'s rule for the sign-in page. There it is that
    // every colour is a `var(--mp-…)`; here there are no custom properties to
    // resolve — Gmail keeps no `:root` rule — so the test is that every literal
    // is one the design system holds. Same rule, one indirection shorter.
    for (const style of every) {
      for (const [colour] of style.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)) {
        expect(values, colour).toContain(colour);
      }
    }
  });

  it("uses no custom property, because nothing would resolve one", () => {
    for (const style of every) {
      expect(style).not.toContain("var(");
    }
  });

  it("expands a type step rather than restating one", () => {
    // `text` holds each step as a `font` shorthand without the family; Outlook's
    // engine is Word's, so it is split into longhand. A second spelling of a size
    // would be the seventh scale `tokens.ts` warns about.
    const [, weight, size, lineHeight] = /^(\d+) ([\d.]+px)\/([\d.]+)$/.exec(text.body) ?? [];
    expect(paragraphStyle).toContain(`font-size: ${size}`);
    expect(paragraphStyle).toContain(`font-weight: ${weight}`);
    expect(paragraphStyle).toContain(`line-height: ${lineHeight}`);
  });

  it("draws the button the sheet's own button is drawn with", () => {
    // `.mp-btn--block` is `padding: 10px var(--mp-space-md)` and
    // `border-radius: var(--mp-radius-block)`; `.mp-btn--primary` is
    // `--mp-on-accent` on `--mp-accent` with the ramp to `--mp-accent-hover`.
    // This is where those two rules are held to, since nothing else can be.
    expect(buttonStyle).toContain(`padding: 10px ${space.md}`);
    expect(buttonStyle).toContain(`border-radius: ${radius.block}`);
    expect(buttonStyle).toContain(`color: ${palette.light["on-accent"]}`);
    expect(buttonStyle).toContain(`background-color: ${palette.light.accent}`);
    expect(buttonStyle).toContain(palette.light["accent-hover"]);
  });

  it("carries the mark's own colours on the ribbon, which are the same in both themes", () => {
    // `BRAND_MARK` is deliberately identical in `palette.light` and
    // `palette.dark`, which is what makes a light-only mail safe here: the one
    // element drawn from the brand ramp does not depend on which half was used.
    expect(STYLES.mailRibbonStyle).toContain(palette.light["brand-from"]);
    expect(STYLES.mailRibbonStyle).toContain(palette.light["brand-to"]);
    expect(palette.dark["brand-from"]).toBe(palette.light["brand-from"]);
    expect(palette.dark["brand-to"]).toBe(palette.light["brand-to"]);
  });

  it("paints the page behind the card, which is what a card needs to be on", () => {
    expect(STYLES.mailBodyStyle).toContain(`background-color: ${palette.light.stage}`);
    expect(STYLES.mailPageStyle).toContain(`background-color: ${palette.light.stage}`);
  });
});
