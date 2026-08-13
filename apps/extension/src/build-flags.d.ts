/**
 * Build-time constants substituted by esbuild's `define` (scripts/build.mjs) and
 * by vitest's, never read at runtime: `if (__DEV__)` folds to a constant, so the
 * false branch is eliminated from the bundle rather than shipped and skipped.
 *
 * True only in `npm run build:dev`. Guard anything that must not reach a
 * published build with it — see the service worker's manual test hooks.
 */
declare const __DEV__: boolean;
