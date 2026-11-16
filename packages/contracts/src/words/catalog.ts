/**
 * What holds a second Language's catalog to the first's (ADR-0043): Dutch is the
 * source, and every other catalog has its keys — no more, no fewer.
 *
 * Shared because three catalogs are held this way, the plan sentences here and one
 * per app, and a rule written three times is the copy that drifts.
 */

/**
 * A catalog with exactly `Source`'s keys, every leaf a string of its own.
 *
 * Written `export const en = { … } satisfies CatalogOf<typeof nl>`: a missing key
 * and an extra one are both compile errors, which is the type half of the hold.
 * An array stays an array of the same element shape, so a legal document's
 * paragraphs are held too.
 */
export type CatalogOf<Source> = Source extends string
  ? string
  : Source extends readonly (infer Element)[]
    ? readonly CatalogOf<Element>[]
    : { [Key in keyof Source]: CatalogOf<Source[Key]> };

/**
 * Every leaf of a catalog by its dotted path, arrays by index, in the order the
 * catalog writes them — the runtime half of the hold, which one test per catalog
 * compares against the Dutch.
 *
 * The type cannot see an array's length, and an English legal document with a
 * paragraph missing is exactly what this exists to catch.
 */
export function keyPaths(catalog: unknown, prefix = ""): string[] {
  if (typeof catalog !== "object" || catalog === null) return [prefix];
  return Object.entries(catalog).flatMap(([key, value]) =>
    keyPaths(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}
