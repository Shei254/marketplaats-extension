/**
 * The **Language** (ADR-0043): which of two languages a surface says **Our words**
 * in. Shared because both clients choose one by the same rule and hand it to the
 * plan sentences in `./wording`.
 */
export const LANGUAGES = ["nl", "en"] as const;

export type Language = (typeof LANGUAGES)[number];

/** What a list naming neither language gets, and what every build is pinned to until T97. */
export const DUTCH: Language = "nl";

/**
 * The browser-list rule: the first of Dutch or English in the browser's own list
 * (`navigator.languages`), and Dutch when it names neither.
 *
 * A tag is read by its language subtag, so `en-GB` is English and `nl-BE` is Dutch.
 */
export function languageFor(browserList: readonly string[]): Language {
  for (const tag of browserList) {
    const language = tag.toLowerCase().split("-")[0];
    const ours = LANGUAGES.find((known) => known === language);
    if (ours) return ours;
  }
  return DUTCH;
}
