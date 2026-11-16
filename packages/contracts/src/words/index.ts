import { createInstance, type i18n } from "i18next";

import { DUTCH, type Language } from "../language";
import { nl } from "./nl";

/** The namespace the plan sentences live in, on this instance and in an app's key types. */
export const PLAN_WORDS = "plans";

/**
 * The plan sentences' own i18next instance (ADR-0043): bundled, initialised
 * synchronously, and separate from each app's so that a `Language` is an argument
 * here and never something this package has to be told about beforehand.
 *
 * **Made on first use, not on import.** Everything that reads a wire type imports
 * this package, the relay content script on every marktplaats.nl page among them,
 * and a module that did work as it loaded could not be dropped from the bundles
 * that say no plan sentence at all.
 *
 * Values are not escaped: these are sentences for React and for plain text, and a
 * tier named "Pro & Co" must read that way.
 */
let words: i18n | undefined;

function instance(): i18n {
  if (words) return words;
  words = createInstance();
  void words.init({
    lng: DUTCH,
    fallbackLng: DUTCH,
    ns: [PLAN_WORDS],
    defaultNS: PLAN_WORDS,
    resources: { nl: { [PLAN_WORDS]: nl } },
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return words;
}

/** The plan sentences in one Language. A Language with no catalog yet reads Dutch. */
export function planWords(language: Language) {
  return instance().getFixedT(language, PLAN_WORDS);
}

export { nl as planWordsNl };
