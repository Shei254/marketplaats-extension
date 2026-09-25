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

  it("draws the brand mark centred in its own box, so a tile around it is balanced", () => {
    // Every surface sets the mark in a square tile, and a glyph that sits low in
    // its 20×20 box sits low in every tile at once (T86). The stroke is round and
    // one width throughout, so it widens the ink equally on every side and the
    // centre of the ink is the centre of the vertices.
    const markup = renderToStaticMarkup(<Icon name="logo" />);
    expect(markup).toContain('stroke-linecap="round"');
    expect(markup).toContain('stroke-linejoin="round"');
    const points = shapesIn(markup).flatMap(polylinePoints);
    const centre = (axis: 0 | 1) => {
      const values = points.map((point) => point[axis]);
      return (Math.min(...values) + Math.max(...values)) / 2;
    };

    expect(centre(0)).toBeCloseTo(10, 5);
    expect(centre(1)).toBeCloseTo(10, 5);
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

/**
 * The vertices of a path made of straight lines — `M`/`L`/`H`/`V` and their
 * relative forms, which is all the brand mark is drawn with. A curve command is
 * refused rather than approximated, so a redrawn mark cannot pass by accident.
 */
function polylinePoints(shape: string): [number, number][] {
  const d = /^path d=([^=]*)$/.exec(shape)?.[1];
  if (d === undefined) throw new Error(`the mark is drawn in bare paths; got \`${shape}\``);
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+/g) ?? [];
  const points: [number, number][] = [];
  let x = 0;
  let y = 0;
  let command = "";
  for (let i = 0; i < tokens.length; ) {
    if (/[a-zA-Z]/.test(tokens[i]!)) command = tokens[i++]!;
    const next = () => Number(tokens[i++]);
    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case "M":
      case "L": {
        const [dx, dy] = [next(), next()];
        [x, y] = relative ? [x + dx, y + dy] : [dx, dy];
        break;
      }
      case "H":
        x = relative ? x + next() : next();
        break;
      case "V":
        y = relative ? y + next() : next();
        break;
      default:
        throw new Error(`the mark is drawn in straight lines; got \`${command}\``);
    }
    points.push([x, y]);
  }
  return points;
}
