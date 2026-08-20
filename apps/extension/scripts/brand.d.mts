/**
 * Types for `brand.mjs`. Hand-written for the same reason as
 * `extension-key.d.mts`: `allowJs` would pull every script here into strict
 * checking, including ones nothing is asking to change.
 */

/**
 * What every template and consumer may rely on. `readBrand` verifies these are
 * present and non-empty before returning, so the declaration is a checked claim
 * rather than a hopeful one. The index signature carries anything else the file
 * holds, and stays subject to `noUncheckedIndexedAccess`.
 */
export interface Brand {
  name: string;
  tagline: string;
  domain: string;
  supportEmail: string;
  [key: string]: string;
}

/** Reads the root `brand.json`, dropping `$`-prefixed keys, which are notes. Throws if a required key is missing. */
export declare function readBrand(url?: URL): Promise<Brand>;

/** Replaces every `{{brand.key}}` in `text`. Throws on an unknown key or a leftover token. */
export declare function resolveTokens(
  text: string,
  brand: Record<string, string>,
  escape?: (value: string) => string,
): string;

/** The same, over a parsed JSON tree; non-strings pass through. */
export declare function resolveJson<T>(node: T, brand: Record<string, string>): T;

/** Escapes `& < > " '` for interpolation into markup. */
export declare function escapeHtml(value: string): string;
