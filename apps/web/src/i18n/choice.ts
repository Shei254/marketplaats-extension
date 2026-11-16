import { asLanguage, languageOnScreen, type Language } from "@mprelist/contracts";

import { words } from "./words";

/**
 * Where the site keeps its **Language** (ADR-0043, T97), and how a visit arrives
 * at one.
 *
 * **The browser's storage**, the device's (`./browser-language` reaches it):
 * nothing is stored on the account or sent to the API. **Nothing chosen is a
 * state** — no key means the browser's list decides, on the site as in the popup
 * — and a choice, once made, always wins.
 *
 * **`?lang` on an incoming link sets the choice.** It is how the popup hands its
 * Language over (`onTheSite` in the extension), and it is kept rather than read
 * once, so the next page of the visit is in the same Language. It is then taken
 * out of the address: left in, a reload would undo a press of the switch.
 */
export const LANGUAGE_KEY = "mprelist.language";

/** The slice of `Storage` this needs, so a test hands it a plain object. */
export type LanguageStore = Pick<Storage, "getItem" | "setItem">;

function stored(store: LanguageStore | undefined): Language | null {
  try {
    return asLanguage(store?.getItem(LANGUAGE_KEY));
  } catch {
    // A profile with site data blocked throws on access. No choice is the answer.
    return null;
  }
}

function keep(language: Language, store: LanguageStore | undefined): void {
  try {
    store?.setItem(LANGUAGE_KEY, language);
  } catch {
    // Kept for as long as the page is open, which is all that can be done.
  }
}

/**
 * The Language a visit arrives in, and the query it leaves in the address once
 * `?lang` is taken out. Applied by `main.tsx`, before the first render.
 */
export function arriving({
  search,
  store,
  browserList,
}: {
  search: string;
  store: LanguageStore | undefined;
  browserList: readonly string[];
}): { language: Language; search: string } {
  const query = new URLSearchParams(search);
  const carried = asLanguage(query.get("lang"));
  query.delete("lang");
  const rest = query.toString();
  if (carried) keep(carried, store);
  return { language: languageOnScreen(carried ?? stored(store), browserList), search: rest ? `?${rest}` : "" };
}

/** Puts a Language on screen: every sentence on the site reads it next. */
export function showLanguage(language: Language): void {
  void words.changeLanguage(language);
}

/** The **Language switch**'s press: on screen at once, and kept. */
export function chooseLanguage(language: Language, store: LanguageStore | undefined): void {
  showLanguage(language);
  keep(language, store);
}
