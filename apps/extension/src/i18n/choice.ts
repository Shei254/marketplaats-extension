import { asLanguage, languageOnScreen, type Language } from "@mprelist/contracts";

import { words } from "./words";

/**
 * Where the extension keeps its **Language** (ADR-0043, T97), and how each of its
 * three contexts follows it.
 *
 * **`chrome.storage.local`, unlike the theme.** The popup, the **Page button**'s
 * content script and the worker all read the Language — the worker carries it to
 * the sign-in page and to Stripe — and this is the one store all three see. Its
 * `onChanged` is how the Page button re-labels while the popup is pressed, with no
 * reload. The popup pays for it with one read before its first render
 * (`popup-entry.tsx`), which is why the theme, read by nobody else, stays in
 * `localStorage` (`../popup/theme.ts`).
 *
 * **Nothing chosen is a state**: no key means the browser's list decides, and a
 * value that is not a Language is read as no key.
 */
export const LANGUAGE_KEY = "mprelist.language";

/** What following the Language needs, so a test hands it plain objects. */
export interface LanguageSource {
  storage: {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  };
  onChanged: {
    addListener(listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void): void;
  };
  /** `navigator.languages`, asked each time, since a context can outlive a change of it. */
  browserList(): readonly string[];
  /** Puts a Language on screen. The extension's words, unless a test says otherwise. */
  apply?(language: Language): void;
}

/** The real source, in any of the three contexts. */
export function chromeLanguageSource(): LanguageSource {
  return {
    storage: chrome.storage.local,
    onChanged: chrome.storage.onChanged,
    browserList: () => globalThis.navigator?.languages ?? [],
  };
}

function applyToWords(language: Language): void {
  void words.changeLanguage(language);
}

/**
 * Reads the choice, puts it on screen, and keeps following it. Listens before it
 * reads, and a change seen meanwhile beats the read, which may be older than it.
 * Resolves once the first Language is on screen.
 */
export async function followLanguage(source: LanguageSource): Promise<void> {
  const apply = source.apply ?? applyToWords;
  let changed = false;
  source.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !(LANGUAGE_KEY in changes)) return;
    changed = true;
    apply(languageOnScreen(asLanguage(changes[LANGUAGE_KEY]?.newValue), source.browserList()));
  });
  let stored: Language | null = null;
  try {
    stored = asLanguage((await source.storage.get(LANGUAGE_KEY))[LANGUAGE_KEY]);
  } catch {
    // No store to read: the browser's list decides, as it does for nothing chosen.
  }
  if (!changed) apply(languageOnScreen(stored, source.browserList()));
}

/**
 * The **Language switch**'s press: on screen here at once, then kept, which is what
 * tells the other two contexts. A store that refuses still changes this popup.
 */
export async function chooseLanguage(language: Language, source: LanguageSource): Promise<void> {
  (source.apply ?? applyToWords)(language);
  try {
    await source.storage.set({ [LANGUAGE_KEY]: language });
  } catch {
    // Kept for as long as the popup is open, which is all that can be done.
  }
}
