/**
 * Build-time constants substituted by esbuild's `define` (scripts/build.mjs) and
 * by vitest's. Never read at runtime, never assigned.
 *
 * True only in `npm run build:dev`. Guard anything that must not reach a
 * published build with it — see the service worker's manual test hooks. What the
 * default build does with the false branch, and why that takes more than
 * `define`, is scripts/build.mjs's docstring.
 */
declare const __DEV__: boolean;

/**
 * The product's name, from the root `brand.json` (T48, #78) — the same file the
 * manifest and `popup.html` take theirs from, substituted rather than imported so
 * that a rename stays one edit and a rebuild.
 *
 * Defined for the popup, which draws the name in its header. The templated
 * `{{brand.name}}` tokens cannot reach here: those are resolved in HTML and JSON
 * text, and this is a bundle.
 */
declare const __BRAND_NAME__: string;
