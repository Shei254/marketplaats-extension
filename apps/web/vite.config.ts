import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";

import { resolveBrandTokens } from "./src/brand";

/** The monorepo root, which is where `brand.json` lives — outside this workspace. */
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * `index.html` is the one file here React never renders, so it cannot read
 * `BRAND` itself. This is the extension build's `{{brand.name}}` substitution
 * (`scripts/build.mjs`) in the shape Vite offers for it — and, like that one, it
 * throws on an unknown key or a token left standing rather than shipping either.
 */
const brandTokens: Plugin = {
  name: "mprelist-brand-tokens",
  transformIndexHtml: { order: "pre", handler: (html) => resolveBrandTokens(html) },
};

/**
 * One build, one bundle, one `index.html` (ADR-0017).
 *
 * **No `@vitejs/plugin-react`.** Vite transforms `.tsx` with esbuild and takes the
 * automatic JSX runtime from this workspace's `tsconfig.json`, the same way
 * `packages/ui` states its own — so the plugin would buy Fast Refresh and a Babel
 * pass, on a site of static pages with no state to preserve across an edit. The
 * dev server full-reloads instead, which is the whole of what is lost.
 */
export default defineConfig({
  plugins: [brandTokens],
  server: {
    fs: {
      // `src/brand.ts` imports the root `brand.json`, which is above this
      // workspace. Stated rather than left to Vite's workspace detection, which
      // is inference over a lock file and silently narrower if it ever changes.
      allow: [repoRoot],
    },
  },
});
