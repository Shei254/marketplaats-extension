import { cssVarName, palette, staticTokens, type Theme } from "./tokens";

/**
 * The token sheet as CSS, generated from `tokens.ts` rather than kept beside it.
 * A palette that is written once and rendered twice cannot drift; two hand-kept
 * copies of #0a5fd6 can, and the first anyone notices is a button that is the
 * wrong blue in one of the two apps.
 *
 * Four blocks, in this order, and the order is what makes the toggle work:
 *
 *   1. light on `:root, :host, .mp-theme` — the base, and `:host` is there because
 *      inside the shadow root T41 (#50) injects into, `:root` matches nothing;
 *   2. dark under `prefers-color-scheme`, which is what the POC popup does today
 *      and what a user who has never touched a toggle gets;
 *   3. dark under `[data-mp-theme="dark"]`, for a surface that has been told;
 *   4. light under `[data-mp-theme="light"]`, last, so *both* directions of the
 *      toggle beat the system preference rather than only one.
 *
 * Block 2 excludes an element that asked for light, so 2 and 4 never argue on the
 * same element; where they can (a shadow host), 4 is later and wins.
 */

const DARK_SELECTORS = [
  ':root:not([data-mp-theme="light"])',
  ":host",
  '.mp-theme:not([data-mp-theme="light"])',
];

function declarations(values: Record<string, string>, indent: string): string {
  return Object.entries(values)
    .map(([token, value]) => `${indent}  ${cssVarName(token)}: ${value};`)
    .join("\n");
}

function rule(selectors: string[], values: Record<string, string>, indent = ""): string {
  const head = selectors.map((selector) => `${indent}${selector}`).join(",\n");
  return `${head} {\n${declarations(values, indent)}\n${indent}}`;
}

/** The custom properties, both themes. Inject once per document or shadow root. */
export const themeCss = [
  rule([":root", ":host", ".mp-theme"], { ...staticTokens, ...palette.light }),
  `@media (prefers-color-scheme: dark) {\n${rule(DARK_SELECTORS, palette.dark, "  ")}\n}`,
  rule(['[data-mp-theme="dark"]'], palette.dark),
  rule(['[data-mp-theme="light"]'], palette.light),
].join("\n\n");

/**
 * The attribute that pins a subtree to one theme. Nothing in the popup sets it —
 * the popup follows the browser, as it always has — but `apps/web` (T50) and any
 * screenshot of a single theme need a way to say so.
 */
export function themeAttribute(theme: Theme): { "data-mp-theme": Theme } {
  return { "data-mp-theme": theme };
}
