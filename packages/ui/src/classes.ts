/**
 * Joins class names, dropping anything falsy, so a component can write
 * `classes("mp-btn", inert && "mp-btn--locked", className)` without a `clsx`
 * dependency for four lines of work.
 */
export function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(" ");
}
