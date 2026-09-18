/**
 * `theme.properties`, which is the one file in this theme that Java reads.
 *
 * Keycloak loads it into a `java.util.Properties`, and everything a template
 * says about this product arrives through it — the brand's four values and the
 * class name each `kc…Class` hook is given. So this module is the boundary
 * between a JavaScript string and a format with its own opinions about five
 * punctuation characters and about what a byte above 0x7e means.
 */

/**
 * The escapes, in the order they have to be applied: the backslash first, or
 * every escape written after it is escaped a second time.
 *
 * `=` `:` `#` `!` are the four characters that would otherwise end the value or
 * begin a comment. A newline would end the line, which is worse than it sounds —
 * the remainder becomes a *key*, so a tagline with a line break in it silently
 * adds a property nothing reads.
 */
const ESCAPES: Array<[RegExp, string]> = [
  [/\\/g, "\\\\"],
  [/\n/g, "\\n"],
  [/\r/g, "\\r"],
  [/\t/g, "\\t"],
  [/=/g, "\\="],
  [/:/g, "\\:"],
  [/#/g, "\\#"],
  [/!/g, "\\!"],
];

/**
 * A value as `Properties` will read it back.
 *
 * **Everything outside printable ASCII becomes `\uXXXX`.** `Properties.load` of
 * an `InputStream` decodes ISO-8859-1; the same file read through a UTF-8
 * `Reader` decodes UTF-8; and `brand.tagline` carries "één", so the two readings
 * differ on a file this repository has to be right about without knowing which
 * one Keycloak picked. The escape is the spelling both agree on, and it costs
 * nothing — nobody reads the generated file for pleasure.
 *
 * A leading space is escaped for the same reason a `=` is: `Properties` strips
 * it, so a value that starts with one comes back a different string.
 */
function escapeValue(value: string): string {
  const escaped = ESCAPES.reduce((text, [pattern, with_]) => text.replace(pattern, with_), value)
    .replace(/[^\x20-\x7e]/g, (character) => {
      const code = character.codePointAt(0) ?? 0;
      return `\\u${code.toString(16).padStart(4, "0")}`;
    })
    .replace(/^ /, "\\ ");
  return escaped;
}

/** The entries as a `.properties` file, one key per line, in the order given. */
export function propertiesFile(entries: Record<string, string>): string {
  return Object.entries(entries)
    .map(([key, value]) => `${key}=${escapeValue(value)}\n`)
    .join("");
}
