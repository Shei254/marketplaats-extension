import { arriving, showLanguage, type LanguageStore } from "./choice";
import { words } from "./words";

/**
 * The one file in the public bundle that reaches the browser's storage, and only
 * for the **Language** (ADR-0043, T97): a preference of the device's, which says
 * nothing about who is looking. `no-identity.test.ts` names it as its exception
 * and holds it to that — it keeps one key, through `./choice`.
 */
export function languageStore(): LanguageStore | undefined {
  try {
    return localStorage;
  } catch {
    // Site data blocked: the link's or the browser's Language, kept nowhere.
    return undefined;
  }
}

/**
 * The public site's Language, before anything is drawn: `?lang` from the popup,
 * else the choice kept on this device, else the browser's list. `?lang` is taken
 * out of the address once kept, so a reload cannot undo a press of the switch,
 * and `<html lang>` follows the Language from here on.
 */
export function arriveInLanguage(): void {
  const arrival = arriving({ search: location.search, store: languageStore(), browserList: navigator.languages ?? [] });
  if (arrival.search !== location.search) {
    history.replaceState(history.state, "", `${location.pathname}${arrival.search}${location.hash}`);
  }
  words.on("languageChanged", (language) => document.documentElement.setAttribute("lang", language));
  showLanguage(arrival.language);
  document.documentElement.setAttribute("lang", arrival.language);
}
