import brand from "../../../brand.json";

/**
 * The product's name, as this site says it (T48, #78).
 *
 * The same one file the extension's manifest and popup read, so renaming before
 * T60 (#91) settles it is still one edit and a rebuild. The extension reaches it
 * through `scripts/brand.mjs`, which validates at build time because a Node
 * script has no compiler standing over it; here the JSON is *imported*, so
 * `resolveJsonModule` types it from the file's own contents and a `brand.json`
 * that lost its `name` fails `npm run typecheck` rather than shipping the string
 * "undefined" onto the page a payment lands on.
 *
 * The fields are picked one by one rather than spread, which is what keeps the
 * `$note` — documentation for whoever edits the file — out of the bundle.
 */
export const BRAND = {
  name: brand.name,
  tagline: brand.tagline,
  domain: brand.domain,
  supportEmail: brand.supportEmail,
} as const;

const TOKEN = /\{\{\s*brand\.([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

/**
 * Replaces every `{{brand.key}}` in a string, for `index.html` — the one file
 * here that React never renders and so cannot read `BRAND` itself.
 *
 * Strict in both directions, exactly as the extension's build is: an unknown key
 * throws, and so does a token left standing. A page whose `<title>` is the
 * literal `{{brand.name}}` is what a Web Store reviewer would read, and a build
 * that stops is cheaper than one that ships that quietly.
 *
 * There is no HTML escaping here and none is needed *yet* — but a brand is
 * exactly the kind of thing that acquires an ampersand, so the values are checked
 * rather than trusted: a token whose value carries markup throws too.
 */
export function resolveBrandTokens(text: string): string {
  const resolved = text.replace(TOKEN, (_token, key: string) => {
    if (!Object.hasOwn(BRAND, key)) {
      throw new Error(`brand.json has no \`${key}\` (referenced as {{brand.${key}}})`);
    }
    const value = BRAND[key as keyof typeof BRAND];
    if (/[&<>"']/.test(value)) {
      throw new Error(`brand.${key} carries markup (${value}) and this template does not escape it`);
    }
    return value;
  });
  const leftover = resolved.match(/\{\{[^}]*\}\}/);
  if (leftover) throw new Error(`unresolved template token ${leftover[0]}`);
  return resolved;
}
