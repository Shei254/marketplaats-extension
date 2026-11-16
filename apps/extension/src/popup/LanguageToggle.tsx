import { LANGUAGE_NAMES, otherLanguage } from "@mprelist/contracts";
import { Button } from "@mprelist/ui";
import type { JSX } from "react";

import { chooseLanguage, chromeLanguageSource } from "../i18n/choice";
import { useTranslation } from "../i18n/react";
import { language } from "../i18n/words";

/**
 * The popup's **Language switch** (ADR-0043, T97), beside the theme switch and the
 * same shape as it: it offers the Language a press leads to. That one is written
 * as its code and named in itself — `EN`, read out as "English" — so a reader who
 * cannot read the popup can still find it. `lang` on the button lets a screen
 * reader say the name in the right voice.
 *
 * In the header on every screen, signed out included: the Language is the
 * device's, not the account's (`../i18n/choice.ts` says where it is kept, and how
 * the **Page button** and the worker follow it).
 */
export function LanguageToggle(): JSX.Element {
  // Subscribes this button to a change of Language, wherever it was made.
  useTranslation();
  const next = otherLanguage(language());
  return (
    <Button
      tone="ghost"
      lang={next}
      aria-label={LANGUAGE_NAMES[next]}
      title={LANGUAGE_NAMES[next]}
      onClick={() => void chooseLanguage(next, chromeLanguageSource())}
    >
      {next.toUpperCase()}
    </Button>
  );
}
