import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { escapeHtml, readBrand, resolveJson, resolveTokens } from "./brand.mjs";

/**
 * Two builds from one script.
 *
 * **This docstring is where the `__DEV__` mechanism is explained.** The files
 * that touch the flag — src/build-flags.d.ts, src/background/service-worker.ts,
 * vitest.config.ts, scripts/build.test.ts — state their own stake in it and
 * point here rather than re-deriving it, so there is one account to keep true
 * instead of several that drift into disagreeing half-versions.
 *
 * `--dev` defines `__DEV__` as true, which is what keeps the service worker's
 * manual test hooks (`__relist`, `__setEndpoints`, …) in the bundle. The default
 * build is the shippable one: `__DEV__` becomes false and the guarded block is
 * eliminated, so no global that can delete a user's ad reaches the Web Store.
 *
 * `define` alone only gets as far as `if (false) { … }` — esbuild substitutes
 * the constant but does not remove the branch. `minifySyntax` is what actually
 * drops it, which is why it is on for the default build and off for `--dev`,
 * where readable output is worth more. Identifiers and property names survive
 * either way; this is not `minify`. `scripts/build.test.ts` asserts the
 * difference against the emitted bytes rather than trusting this comment.
 *
 * That it reaches the whole bundle rather than only the guarded block is
 * deliberate, and was raised in review: esbuild applies `minifySyntax` per build,
 * not per region, so narrowing it is not something the option can express. The
 * cost is that the dev bundle a tester exercises differs from the shipped one by
 * more than the hooks. Accepted, because `minify` is what would make the shipped
 * bundle unreviewable and this is not that — and because the claim that actually
 * matters, that no hook survives, is asserted against the emitted bytes.
 *
 * `npm run build:dev` is the build to load unpacked while live-testing
 * (docs/live-testing.md). `--outdir` exists for the test, so it can build
 * without clobbering dist/ — also raised in review, as a flag with one caller.
 * Kept: the need is present rather than anticipated, and the alternative is a
 * test that either clobbers the directory a tester has loaded unpacked or
 * asserts on a build it did not make.
 */
const { values } = parseArgs({
  options: {
    dev: { type: "boolean", default: false },
    outdir: { type: "string", default: "dist" },
  },
});

const { dev, outdir } = values;
const minifySyntax = !dev;

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

// Read before the bundles rather than after, because the popup draws the product
// name in its header and so needs it substituted in (T29, #38) — the same one
// file the manifest and popup.html take theirs from, so a rename is still one
// edit and a rebuild. `src/build-flags.d.ts` declares both constants.
const brand = await readBrand();
const define = {
  __DEV__: String(dev),
  __BRAND_NAME__: JSON.stringify(brand.name),
  // React ships two implementations of itself behind `process.env.NODE_ENV`: a
  // development one carrying warnings and dev-only bookkeeping, and a production
  // one. Nothing substitutes that for us — and `process` does not exist in a page
  // or a service worker at all, so leaving it in would put a reference that
  // throws on load into the bundle. Stated for both builds, so the dev popup
  // keeps React's warnings and the shipped one keeps neither them nor their
  // weight.
  "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"),
};

// ESM bundles: service worker (type: module) and the module-script pages.
await build({
  entryPoints: {
    background: "src/background/service-worker.ts",
    popup: "src/popup/popup-entry.tsx",
  },
  bundle: true,
  format: "esm",
  target: "chrome110",
  define,
  minifySyntax,
  outdir,
  logLevel: "info",
});

// Content scripts are loaded as classic scripts, not modules → IIFE.
await build({
  entryPoints: { content: "src/content/content-script.ts" },
  bundle: true,
  format: "iife",
  target: "chrome110",
  define,
  minifySyntax,
  outdir,
  logLevel: "info",
});

// Static assets referenced by the manifest. Both carry `{{brand.name}}` tokens
// resolved from the root brand.json (T48, #78) rather than being copied verbatim,
// so the product's name lives in one file and a rename is an edit and a rebuild.
//
// The manifest is resolved as a parsed tree and re-serialised; popup.html is
// resolved as text with HTML escaping. That asymmetry is the point — see
// scripts/brand.mjs. `key` passes through untouched: it is the pinned extension
// id (T44, #13) and nothing about the brand may disturb it.
const manifest = resolveJson(JSON.parse(await readFile("public/manifest.template.json", "utf8")), brand);
await writeFile(`${outdir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

const popup = resolveTokens(await readFile("src/popup/popup.html", "utf8"), brand, escapeHtml);
await writeFile(`${outdir}/popup.html`, popup);

console.log(
  `Built ${brand.name} (${dev ? "dev" : "production"}) into ${outdir}/ — load it unpacked in chrome://extensions.`,
);
