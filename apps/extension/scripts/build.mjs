import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const outdir = "dist";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

// ESM bundles: service worker (type: module) and the module-script pages.
await build({
  entryPoints: {
    background: "src/background/service-worker.ts",
    popup: "src/popup/popup.ts",
    options: "src/options/options.ts",
  },
  bundle: true,
  format: "esm",
  target: "chrome110",
  outdir,
  logLevel: "info",
});

// Content scripts are loaded as classic scripts, not modules → IIFE.
await build({
  entryPoints: { content: "src/content/content-script.ts" },
  bundle: true,
  format: "iife",
  target: "chrome110",
  outdir,
  logLevel: "info",
});

// Static assets referenced by the manifest.
await cp("public/manifest.json", `${outdir}/manifest.json`);
await cp("src/popup/popup.html", `${outdir}/popup.html`);
await cp("src/options/options.html", `${outdir}/options.html`);

console.log(`Built extension into ${outdir}/ — load it unpacked in chrome://extensions.`);
