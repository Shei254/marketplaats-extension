import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { iconSet } from "@mprelist/ui/icon-png";
import { defineConfig, type Plugin } from "vite";

import { resolveBrandTokens } from "./src/brand";
import { ICON_MASTER, SITE_ICONS } from "./src/icons";

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
 * The tab icon and the home-screen one, resized from the master `brand.json`
 * names (T48, #78) — `src/icons.ts` is what they are and why there are two.
 *
 * **Emitted rather than committed**, so the artwork exists once in this
 * repository. **At the site root rather than in `assets/`**, because a favicon is
 * fetched by a browser that has not read the HTML and by iOS at a fixed name,
 * neither of which can follow a content hash — and because `nginx.conf.template`
 * caches `/assets/` for a year on the promise that hashed names change with
 * their bytes.
 *
 * The dev server is served the same bytes from memory. Without that, `vite dev`
 * would 404 two links on every page load, which is the kind of noise somebody
 * eventually silences by committing a copy of the icon into `public/` — the one
 * outcome this plugin exists to prevent.
 */
const brandIcons: Plugin = {
  name: "mprelist-brand-icons",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const path = (request.url ?? "").split("?")[0]?.replace(/^\//, "") ?? "";
      if (!Object.hasOwn(SITE_ICONS, path)) return next();

      response.setHeader("Content-Type", "image/png");
      response.end(Buffer.from(drawn().get(SITE_ICONS[path as keyof typeof SITE_ICONS])!));
    });
  },
  generateBundle() {
    for (const [path, size] of Object.entries(SITE_ICONS)) {
      this.emitFile({ type: "asset", fileName: path, source: Buffer.from(drawn().get(size)!) });
    }
  },
};

/**
 * Both sizes, drawn once for the life of the process.
 *
 * Decoding the master is what this costs — it is 2000×2000 — and a dev server
 * would otherwise pay it on every request for a tab icon. The cost of the memo
 * is that redrawing the artwork while `vite dev` is running needs a restart,
 * which is the same thing changing this config needs.
 */
let icons: Map<number, Uint8Array> | undefined;

function drawn(): Map<number, Uint8Array> {
  return (icons ??= iconSet(readFileSync(ICON_MASTER), Object.values(SITE_ICONS)));
}

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
  plugins: [brandTokens, brandIcons],
  server: {
    fs: {
      // `src/brand.ts` imports the root `brand.json`, which is above this
      // workspace. Stated rather than left to Vite's workspace detection, which
      // is inference over a lock file and silently narrower if it ever changes.
      allow: [repoRoot],
    },
  },
});
