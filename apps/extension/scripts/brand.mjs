import { readFile } from "node:fs/promises";

/**
 * One source for every user-facing name (T48, #78).
 *
 * The product's *brand* and its *identifier* are different things and this module
 * is the line between them. `mprelist` is the identifier: it is in `com.mprelist`,
 * `@mprelist/*`, the Keycloak realm and its clients, and the Postgres database,
 * and moving it is a repo-wide refactor and a `down -v`. The brand is what a user
 * reads, it lives in one file, and moving it is this file plus a rebuild — which
 * is the whole point, because it is still provisional until T60 (#91).
 *
 * Templates carry `{{brand.name}}` tokens. Resolution is deliberately strict in
 * both directions: an unknown key throws, and so does a token left standing. A
 * build that quietly shipped `{{brand.name}}` into the Web Store listing, or
 * quietly shipped nothing where a name should be, is worse than one that stops.
 */

const BRAND = new URL("../../../brand.json", import.meta.url);

/** Keys that are documentation for whoever edits the file, not values to render. */
const NOT_A_VALUE = /^\$/;

/**
 * Every key a template or a consumer may rely on. Checked at read time rather than
 * declared and hoped for: a `brand.json` missing `name` would otherwise reach a
 * template, resolve to `undefined`, and ship as the string "undefined".
 */
const REQUIRED = ["name", "tagline", "domain", "supportEmail", "icon"];

/** @returns {Promise<Record<string, string>>} */
export async function readBrand(url = BRAND) {
  const parsed = JSON.parse(await readFile(url, "utf8"));
  const brand = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => !NOT_A_VALUE.test(key)),
  );
  const missing = REQUIRED.filter((key) => typeof brand[key] !== "string" || brand[key] === "");
  if (missing.length > 0) {
    throw new Error(`brand.json is missing or empty: ${missing.join(", ")}`);
  }
  return brand;
}

/**
 * The artwork `brand.icon` names, resolved against `brand.json`'s own directory
 * rather than the caller's.
 *
 * Where the brand's *files* are is the same question as what it is called, so it
 * is answered here: a build that resolved the path itself would be a second
 * place that knows the repository's shape, and it would go on working from the
 * one directory it was written in.
 *
 * @param {Record<string, string>} brand
 * @param {URL} [url] where `brand.json` was read from.
 * @returns {Promise<Uint8Array>}
 */
export async function readIconMaster(brand, url = BRAND) {
  const master = new URL(brand.icon, url);
  try {
    return new Uint8Array(await readFile(master));
  } catch (cause) {
    throw new Error(`brand.json names an icon that is not there: ${brand.icon}`, { cause });
  }
}

const TOKEN = /\{\{\s*brand\.([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

/**
 * Replaces every `{{brand.key}}` in a string.
 *
 * @param {string} text
 * @param {Record<string, string>} brand
 * @param {(value: string) => string} [escape] how a value is made safe for the
 *   surrounding syntax. Identity for JSON, where the value is placed into a
 *   parsed tree and re-serialised; HTML-escaping for markup, where it is not —
 *   a brand containing `&` or `<` would otherwise emit broken HTML, and a name
 *   is exactly the kind of thing that acquires an ampersand.
 * @returns {string}
 */
export function resolveTokens(text, brand, escape = (value) => value) {
  const resolved = text.replace(TOKEN, (_token, key) => {
    if (!Object.hasOwn(brand, key)) {
      throw new Error(`brand.json has no \`${key}\` (referenced as {{brand.${key}}})`);
    }
    return escape(brand[key]);
  });
  const leftover = resolved.match(/\{\{[^}]*\}\}/);
  if (leftover) throw new Error(`unresolved template token ${leftover[0]}`);
  return resolved;
}

/**
 * The same, over a parsed JSON tree. Structured rather than string templating, so
 * the template stays a real `.json` file — diffable, and wrong in an editor rather
 * than at build time — and so a value carrying a quote cannot break the output.
 *
 * @template T
 * @param {T} node
 * @param {Record<string, string>} brand
 * @returns {T}
 */
export function resolveJson(node, brand) {
  if (typeof node === "string") return /** @type {T} */ (resolveTokens(node, brand));
  if (Array.isArray(node)) return /** @type {T} */ (node.map((item) => resolveJson(item, brand)));
  if (node && typeof node === "object") {
    return /** @type {T} */ (
      Object.fromEntries(Object.entries(node).map(([key, value]) => [key, resolveJson(value, brand)]))
    );
  }
  return node;
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** @param {string} value */
export function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}
