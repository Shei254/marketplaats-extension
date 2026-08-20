import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { canvasIcons, shapesIn } from "../testing/canvas";
import { Icon, iconNames } from "./Icon";

const drawn = canvasIcons();

describe("every icon is the canvas's icon", () => {
  for (const name of iconNames) {
    it(name, () => {
      const markup = renderToStaticMarkup(<Icon name={name} />);
      const shapes = shapesIn(markup);
      const strokeWidth = /stroke-width="([^"]*)"/.exec(markup)?.[1];

      // Geometry *and* stroke width, together: the same paths at a different
      // weight is a different icon, and both are things a re-seeded canvas can
      // change. Matching on the pair also means the icon has to exist on some
      // artboard at all, rather than being one this package invented.
      expect(
        drawn.some(
          (icon) =>
            icon.strokeWidth === strokeWidth &&
            icon.shapes.length === shapes.length &&
            icon.shapes.every((shape, index) => shape === shapes[index]),
        ),
        `${name} is drawn nowhere on the canvas at stroke ${strokeWidth}`,
      ).toBe(true);
    });
  }
});

describe("Icon", () => {
  it("is hidden from a screen reader unless it is given a name", () => {
    expect(renderToStaticMarkup(<Icon name="lock" />)).toContain('aria-hidden="true"');
  });

  it("is announced, with its name, when it is carrying meaning on its own", () => {
    const markup = renderToStaticMarkup(<Icon name="warning" label="Something went wrong" />);
    expect(markup).toContain('role="img"');
    expect(markup).toContain("<title>Something went wrong</title>");
    expect(markup).not.toContain("aria-hidden");
  });

  it("defaults to the size the canvas draws it at, and takes an override", () => {
    expect(renderToStaticMarkup(<Icon name="logo" />)).toContain('width="20"');
    expect(renderToStaticMarkup(<Icon name="lock" />)).toContain('width="14"');
    expect(renderToStaticMarkup(<Icon name="check" size={26} />)).toContain('width="26"');
  });

  it("is stroked in the colour it inherits, never one of its own", () => {
    // One tick glyph on a green pill in the popup and on an accent callout in
    // apps/web. A fill would need a second copy of it.
    for (const name of iconNames) {
      const markup = renderToStaticMarkup(<Icon name={name} />);
      expect(markup, name).toContain('stroke="currentColor"');
      expect(markup, name).toContain('fill="none"');
    }
  });
});
