import { LANGUAGE_NAMES, otherLanguage } from "@mprelist/contracts";
import type { JSX } from "react";

import { chooseLanguage, type LanguageStore } from "../i18n/choice";
import { useTranslation } from "../i18n/react";
import { language } from "../i18n/words";

/**
 * The site's **Language switch** (ADR-0043, T97), in the navigation bar on every
 * page. The popup's has the same shape: it offers the Language a press leads to,
 * written as its code and named in itself — `EN`, read out as "English" — so a
 * reader who cannot read the page can still find it.
 *
 * `store` is where the choice is kept (`../i18n/choice.ts`). It is handed in so
 * that `Site` stays a function of its props; absent, a press still changes the
 * page and keeps nothing.
 */
export function LanguageSwitch({ store }: { store?: LanguageStore }): JSX.Element {
  // Subscribes this button, and the page around it, to a change of Language.
  useTranslation();
  const next = otherLanguage(language());
  return (
    <button
      type="button"
      className="web-language"
      lang={next}
      aria-label={LANGUAGE_NAMES[next]}
      title={LANGUAGE_NAMES[next]}
      onClick={() => chooseLanguage(next, store)}
    >
      {next.toUpperCase()}
    </button>
  );
}
