import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { escapeHtml, readBrand, resolveJson, resolveTokens } from "./brand.mjs";
import { LOCAL_STACK, readDeployment } from "./deployment.mjs";

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

// Read here rather than beside the manifest it is written from, because one of its
// fields has to be *in* the bundles below: every call to our own API names the build
// making it (T43, #52), and the version a user can act on is the one Chrome shows —
// which is this one. Parsed once and re-used for the manifest itself further down, so
// the two cannot disagree about the file they came from.
const manifestTemplate = JSON.parse(await readFile("public/manifest.template.json", "utf8"));

// Where this build talks (T56, #87, ADR-0024). Read on **both** builds and used on
// one: the file is what a release depends on, so a `deployment.json` that would
// not ship should fail the build a developer runs a hundred times rather than
// waiting for the release nobody wants to stop. What `--dev` then compiles in is
// the local stack, which is the same split `__DEV__` draws everywhere else.
//
// Neither address can be served to an installed extension — the served document is
// fetched *from* `apiBaseUrl`, and signing in precedes the first fetch of it — so
// there is no version of this that is configuration. scripts/deployment.mjs is
// where that argument is written down.
const deployment = await readDeployment();
const addresses = dev ? LOCAL_STACK : deployment;

const define = {
  __DEV__: String(dev),
  __BRAND_NAME__: JSON.stringify(brand.name),
  __CLIENT_VERSION__: JSON.stringify(manifestTemplate.version),
  __API_BASE_URL__: JSON.stringify(addresses.apiBaseUrl),
  __AUTH_ISSUER__: JSON.stringify(addresses.issuer),
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
const manifest = resolveJson(manifestTemplate, brand);
await writeFile(`${outdir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

const popup = resolveTokens(await readFile("src/popup/popup.html", "utf8"), brand, escapeHtml);
await writeFile(`${outdir}/popup.html`, popup);

// The addresses are named here because they are the one thing about a build that
// is invisible afterwards and expensive to get wrong: two builds of the same
// commit differ by exactly this, and the shipped one cannot be told to move.
console.log(
  `Built ${brand.name} (${dev ? "dev" : "production"}) against ${addresses.apiBaseUrl} `
    + `into ${outdir}/ — load it unpacked in chrome://extensions.`,
);
