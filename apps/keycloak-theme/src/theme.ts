import brand from "../../../brand.json";

import { email } from "./email/index";
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
 * One theme type — `login` or `email` — as the build reads it.
 *
 * A Keycloak theme is `themes/<name>/<type>/`, and the types are independent of
 * each other: each has its own `theme.properties`, its own messages, its own
 * resources and its own templates. So a type is exactly this much, and **adding
 * one is a directory under `src/` and a line in {@link TYPES}** rather than a
 * second workspace with a second copy of the bundling, the escaping and the icon
 * resizing.
 *
 * **`email` is what made that sentence cost something** (T82, ADR-0035). It is
 * still a directory and a line here, and it was not free in `scripts/build.mjs`:
 * an email theme's templates live under `html/` and `text/`, where a login
 * theme's sit flat, so the build had to learn to walk rather than to list.
 *
 * `properties` and `messages` are handed the brand rather than reaching for it,
 * which is what keeps that copy in one place and lets a type decide where in its
 * own files the brand's keys land.
 */
export interface ThemeType {
  /** The type's `theme.properties`, given the brand's keys to merge in. */
  properties(brand: BrandProperties): Record<string, string>;
  /**
   * The type's message bundles: locale tag → key → value, given the brand the
   * way {@link ThemeType.properties} is.
   *
   * Keycloak merges a theme's messages over its parent's, so a bundle names only
   * the strings this product says differently and every other string in every
   * other mail stays Keycloak's own.
   *
   * **Only `email` has any, and that asymmetry is the decision.** `base/login`
   * writes every control `class="${properties.kcInputClass!}"`, so the sign-in
   * page became ours without one of Keycloak's words being touched; `base/email`
   * has no hooks at all and the body of each mail *is* a message, so the words
   * are the only thing there is to own.
   */
  messages(brand: BrandProperties): Record<string, Record<string, string>>;
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
 * **`login` and `email`.** The account and admin consoles keep Keycloak's own
 * and are not surfaces of this product — the admin console is for whoever
 * operates the realm, and nothing links a customer to the account console.
 *
 * `email` is T82 (ADR-0035) and is the type that proved the two spellings above
 * have to match in a second way: a login theme's templates sit flat at the
 * type's root, an email theme's sit under `html/` and `text/`, and both are just
 * "the `.ftl` files in `src/<key>/`" as far as this registry is concerned.
 */
export const TYPES: Record<string, ThemeType> = { login, email };

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
export interface BrandProperties {
  brandName: string;
  brandTagline: string;
  brandDomain: string;
  brandSupportEmail: string;
}

const BRAND_PROPERTIES: BrandProperties = {
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
  /** Bundles written under `messages/`, by the file name Keycloak looks for. */
  messages: Record<string, string>;
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
    // `messages_<locale>.properties` is Keycloak's own spelling of the file, and
    // the escaper that writes it is the one that writes `theme.properties` —
    // which is why Dutch copy full of `é` never has to settle whether Keycloak
    // read the bundle as ISO-8859-1 or through a UTF-8 `Reader`.
    messages: Object.fromEntries(
      Object.entries(spec.messages(BRAND_PROPERTIES)).map(([locale, entries]) => [
        `messages_${locale}.properties`,
        propertiesFile(entries),
      ]),
    ),
    resources: spec.resources,
    icons: spec.icons,
  }));
}
