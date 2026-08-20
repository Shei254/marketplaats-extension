import { describe, expect, it } from "vitest";

import { themeAttribute, themeCss } from "./theme";
import { palette, staticTokens } from "./tokens";

const declarationsOf = (block: string): Record<string, string> =>
  Object.fromEntries(
    [...block.matchAll(/(--mp-[\w-]+)\s*:\s*([^;]+);/g)].map(([, name = "", value = ""]) => [name, value.trim()]),
  );

/** The four blocks, in the order they are emitted. */
const blocks = themeCss.split(/\n\n(?=[.:[@])/);

describe("the token sheet as CSS", () => {
  it("emits light on the document root, a shadow host and an opt-in class", () => {
    expect(blocks[0]).toContain(":root,\n:host,\n.mp-theme {");
  });

  it("declares every token in the light block — the unthemed ones included", () => {
    const declared = declarationsOf(blocks[0] ?? "");
    for (const [token, value] of Object.entries(staticTokens)) {
      expect(declared[`--mp-${token}`], token).toBe(value);
    }
    for (const [token, value] of Object.entries(palette.light)) {
      expect(declared[`--mp-${token}`], token).toBe(value);
    }
  });

  it("re-declares the whole palette in each of the three other blocks", () => {
    // A theme that overrode some of the palette would leave the rest of the light
    // one showing through — light text on a light surface, which is the failure
    // mode of a half-written dark mode.
    for (const [index, expected] of [palette.dark, palette.dark, palette.light].entries()) {
      const declared = declarationsOf(blocks[index + 1] ?? "");
      expect(Object.keys(declared).sort()).toEqual(Object.keys(expected).map((t) => `--mp-${t}`).sort());
      for (const [token, value] of Object.entries(expected)) {
        expect(declared[`--mp-${token}`], token).toBe(value);
      }
    }
  });

  it("follows the browser when nobody has said, which is what the POC popup does", () => {
    expect(blocks[1]).toMatch(/^@media \(prefers-color-scheme: dark\) \{/);
  });

  it("lets an explicit theme win in both directions", () => {
    // Dark by preference, but excluding anything that asked for light; then the
    // explicit blocks, light last so a shadow host that asked for it still wins.
    expect(blocks[1]).toContain(':root:not([data-mp-theme="light"])');
    expect(blocks[2]).toMatch(/^\[data-mp-theme="dark"\] \{/);
    expect(blocks[3]).toMatch(/^\[data-mp-theme="light"\] \{/);
  });

  it("hands out the attribute those blocks key on, rather than having it spelled by hand", () => {
    expect(themeAttribute("dark")).toEqual({ "data-mp-theme": "dark" });
  });
});
