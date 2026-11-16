/**
 * The **Language** (ADR-0043): which of two languages a surface says **Our words**
 * in. Shared because both clients choose one by the same rule and hand it to the
 * plan sentences in `./wording`.
 */
export const LANGUAGES = ["nl", "en"] as const;

export type Language = (typeof LANGUAGES)[number];

/** What a list naming neither language gets. */
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

/**
 * A stored or carried value — `?lang`, a key in storage — read as a Language, or
 * `null` for anything that is not spelled exactly as one. `null` is no choice, so
 * a value nobody can account for falls back to the browser's list rather than
 * pinning a Language nobody picked.
 */
export function asLanguage(value: unknown): Language | null {
  return LANGUAGES.find((known) => known === value) ?? null;
}

/**
 * The Language on screen (ADR-0043): **a choice, once made, always wins**, and
 * while nothing is chosen the browser's list decides. Both clients ask this, each
 * with its own choice — the device's, never the account's.
 */
export function languageOnScreen(chosen: Language | null, browserList: readonly string[]): Language {
  return chosen ?? languageFor(browserList);
}

/** Where a **Language switch** leads: there are two, so it is the other one. */
export function otherLanguage(language: Language): Language {
  return language === "en" ? DUTCH : "en";
}

/**
 * Each Language named in itself, which is how a switch offers it: a reader who
 * cannot read the page they are on can still find their own language's name. Not
 * **Our words** in a catalog, because it does not change with the Language.
 */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = { nl: "Nederlands", en: "English" };
