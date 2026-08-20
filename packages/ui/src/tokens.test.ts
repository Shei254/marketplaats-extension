import { describe, expect, it } from "vitest";

import { canvasTokens } from "./testing/canvas";
import { palette, radius, space, staticTokens, text, type Theme } from "./tokens";

/**
 * The palette against the design canvas, not against itself.
 *
 * A test that restated the hexes here would pass whatever this package decided
 * the accent was. What has to hold is that the accent is *the canvas's* — the
 * sheet ADR-0016 has drawn before this package exists, precisely so the design
 * language is not set by whichever screen was built first.
 */
describe("the palette is the canvas's", () => {
  for (const theme of ["light", "dark"] satisfies Theme[]) {
    describe(theme, () => {
      it("carries every value the canvas declares, and the same value", () => {
        expect(palette[theme]).toEqual(canvasTokens(theme));
      });
    });
  }

  it("declares the same names in both themes", () => {
    expect(Object.keys(palette.dark).sort()).toEqual(Object.keys(palette.light).sort());
  });
});

describe("the unthemed tokens", () => {
  it("emit under their group, so a rule cannot reach a name that is not one", () => {
    expect(Object.keys(staticTokens)).toEqual([
      "font-family",
      ...Object.keys(text).map((step) => `text-${step}`),
      ...Object.keys(space).map((step) => `space-${step}`),
      ...Object.keys(radius).map((step) => `radius-${step}`),
      "spin",
      "spin-reduced",
    ]);
  });

  it("give every type step a weight and a line height, not only a size", () => {
    // The steps are `font` shorthands minus the family. A step that was a bare
    // size would let a rule take it and pick its own weight, which is how a
    // scale stops being one.
    for (const [step, value] of Object.entries(text)) {
      expect(value, step).toMatch(/^\d{3} \d+(\.\d+)?px\/\d+(\.\d+)?$/);
    }
  });

  it("names no colour, since a colour that is not themed is a colour that breaks in the dark", () => {
    for (const [token, value] of Object.entries(staticTokens)) {
      expect(value, token).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
  });
});
