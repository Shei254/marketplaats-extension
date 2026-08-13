import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { parseArgs } from "node:util";

/**
 * Two builds from one script.
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
 * `npm run build:dev` is the build to load unpacked while live-testing
 * (docs/live-testing.md). `--outdir` exists for the test, so it can build
 * without clobbering dist/.
 */
const { values } = parseArgs({
  options: {
    dev: { type: "boolean", default: false },
    outdir: { type: "string", default: "dist" },
  },
});

const { dev, outdir } = values;
const define = { __DEV__: String(dev) };
const minifySyntax = !dev;

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

// ESM bundles: service worker (type: module) and the module-script pages.
await build({
  entryPoints: {
    background: "src/background/service-worker.ts",
    popup: "src/popup/popup.ts",
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

// Static assets referenced by the manifest.
await cp("public/manifest.json", `${outdir}/manifest.json`);
await cp("src/popup/popup.html", `${outdir}/popup.html`);

console.log(
  `Built the ${dev ? "dev" : "production"} extension into ${outdir}/ — load it unpacked in chrome://extensions.`,
);
