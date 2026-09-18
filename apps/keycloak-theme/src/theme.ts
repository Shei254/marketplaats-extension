import brand from "../../../brand.json";

import { login } from "./login/index";
import { propertiesFile } from "./properties";

/**
 * What the theme is called, which is the name each realm's `loginTheme` asks for
 * and the directory the build emits. It is the **identifier** `mprelist` and not
 * the brand: the theme is a thing a Keycloak administrator picks out of a list,
 * and renaming the brand must stay one edit to `brand.json` (T48, #78).
 */
export const THEME_NAME = "mprelist";

/**
 * The artwork every size is drawn from, as `brand.json` spells it — relative to
 * the repository root, which is where that file lives.
 *
 * A path rather than a resolved URL, unlike `apps/web`'s `ICON_MASTER`, because
 * this module is bundled and evaluated by `scripts/build.mjs` rather than
 * imported from disk: `import.meta.url` inside the bundle is the bundle's own
 * address and would resolve against nothing.
 */
export const ICON_MASTER: string = brand.icon;

/**
 * One theme type — `login`, and in time `email` — as the build reads it.
 *
 * A Keycloak theme is `themes/<name>/<type>/`, and the types are independent of
 * each other: each has its own `theme.properties`, its own resources and its own
 * templates. So a type is exactly this much, and **adding one is a directory
 * under `src/` and a line in {@link TYPES}** rather than a second workspace with
 * a second copy of the bundling, the escaping and the icon resizing.
 *
 * `properties` is handed the brand rather than reaching for it, which is what
 * keeps that copy in one place and lets a type decide where in its own file the
 * brand's keys land.
 */
export interface ThemeType {
  /** The type's `theme.properties`, given the brand's keys to merge in. */
  properties(brand: Record<string, string>): Record<string, string>;
  /** Text files written under `resources/`, by the path they are served at. */
  resources: Record<string, string>;
  /** Rasters drawn from {@link ICON_MASTER}, by path under `resources/` → pixels. */
  icons: Record<string, number>;
}

/**
 * Every type this theme provides.
 *
 * The key is Keycloak's own name for the type, because it is both the directory
 * the build emits and the realm setting that selects it — `login` here is what
 * `loginTheme` in the realm exports names. The templates a type replaces are the
 * `.ftl` files in `src/<key>/`, which is why the two spellings have to match.
 *
 * **Only `login`.** The account and admin consoles are not surfaces of this
 * product — the admin console is for whoever operates the realm, and nothing
 * links a customer to the account console. An `email` type is the one that is
 * coming: the realm allows password reset and has an SMTP server, so that mail
 * goes out today in Keycloak's own English template.
 */
export const TYPES: Record<string, ThemeType> = { login };

/**
 * The brand, as every type's templates read it.
 *
 * Handed over as theme properties rather than substituted into the templates,
 * which is what keeps the `.ftl` files in this workspace free of the product's
 * name — they are committed source, and a committed file with the brand in it is
 * the copy `brand.json` exists to not have. It also means this workspace needs no
 * third implementation of the `{{brand.…}}` resolver that `scripts/brand.mjs` and
 * `apps/web/src/brand.ts` each have.
 *
 * FreeMarker escapes `${properties.brandName!}` on the way out — Keycloak renders
 * these templates in an HTML output format, which is why the base theme has to
 * write `?no_esc` wherever it means markup — so a name with an ampersand in it is
 * the template engine's problem rather than this file's.
 */
const BRAND_PROPERTIES: Record<string, string> = {
  brandName: brand.name,
  brandTagline: brand.tagline,
  brandDomain: brand.domain,
  brandSupportEmail: brand.supportEmail,
};

/** One type, rendered down to the bytes `scripts/build.mjs` writes. */
export interface EmittedType {
  /** The directory under the theme's own, and Keycloak's name for the type. */
  type: string;
  /** `theme.properties`, as Java reads it back. */
  properties: string;
  resources: Record<string, string>;
  icons: Record<string, number>;
}

/**
 * Every type, rendered.
 *
 * The build script is deliberately given no say in what a type contains: it
 * makes directories, writes bytes and resizes a PNG. Everything that is a
 * *decision* — what the properties are, what the stylesheet is made of, which
 * sizes the mark is drawn at — is decided here, in TypeScript the suite can read
 * without running a build.
 */
export function themeTypes(): EmittedType[] {
  return Object.entries(TYPES).map(([type, spec]) => ({
    type,
    properties: propertiesFile(spec.properties(BRAND_PROPERTIES)),
    resources: spec.resources,
    icons: spec.icons,
  }));
}
