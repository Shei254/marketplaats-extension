import brand from "../../../brand.json";

/**
 * The tab icon, and the one a phone keeps when somebody adds this site to a home
 * screen (T48, #78).
 *
 * **Build-time only.** Nothing a browser loads imports this file: `vite.config.ts`
 * emits these, `index.html` links them, and `icons.test.ts` holds those two to
 * each other. That is also why it reads `brand.json` itself rather than through
 * `BRAND` — the page's brand is what a page says, and a path to a file on a
 * build machine is not that.
 *
 * The artwork is the single master the extension's icons come from, resized by
 * `packages/ui`'s `icon-png`, so this workspace commits no copy of the mark and
 * a redraw is one file and a rebuild.
 *
 * **Two sizes, and only two.** 32 is the tab, which every browser downscales to
 * 16 better than a separate 16 would survive being drawn; 180 is what iOS takes
 * for a home screen and is the one size that cannot be derived from the other,
 * since it is asked for by name. No `.ico`: the browsers that need one are older
 * than the extension this site exists to sell.
 */
export const SITE_ICONS = {
  "favicon-32.png": 32,
  "apple-touch-icon.png": 180,
} as const;

/**
 * The master itself, resolved once here rather than at each of the two places
 * that read it — which is the same rule `apps/extension/scripts/brand.mjs`
 * states for `readIconMaster`: where the brand's files are is one module's to
 * know.
 */
export const ICON_MASTER = new URL(`../../../${brand.icon}`, import.meta.url);
