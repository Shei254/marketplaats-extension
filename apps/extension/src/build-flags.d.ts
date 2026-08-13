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
