import { DUTCH, type Language } from "@mprelist/contracts";
import { createInstance } from "i18next";

import { BRAND } from "../brand";
import { en } from "./en";
import { nl } from "./nl";

/**
 * The public site's words (ADR-0043): one i18next instance with the catalog
 * bundled — the site's `script-src 'self'` forbids fetching one — and initialised
 * synchronously, so the first paint and a component test both have their
 * sentences.
 *
 * **Pinned to Dutch.** The English catalog is bundled beside it (T96), and nothing
 * chooses it yet: no **Language switch** and no browser rule is wired until T97.
 *
 * Values are not escaped: React escapes what it renders, and a tier named
 * "Pro & Co" must read that way on its own button.
 */
export const words = createInstance();
void words.init({
  lng: DUTCH,
  fallbackLng: DUTCH,
  resources: { nl: { translation: nl }, en: { translation: en } },
  interpolation: {
    escapeValue: false,
    defaultVariables: { brand: BRAND.name, supportEmail: BRAND.supportEmail },
  },
  initAsync: false,
});

/** A sentence in the Language on screen, for the code that is not a component. */
export const t = words.t;

/** The Language on screen, for the plan sentences `@mprelist/contracts` words. */
export function language(): Language {
  return words.language === "en" ? "en" : DUTCH;
}
