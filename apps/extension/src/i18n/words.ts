import { DUTCH, type Language } from "@mprelist/contracts";
import { createInstance } from "i18next";

import { en } from "./en";
import { nl } from "./nl";

/**
 * The extension's words (ADR-0043): one i18next instance for the popup, the
 * **Page button** and the worker, with the catalog bundled — Manifest V3 forbids
 * fetching one — and initialised synchronously, so the first render and a
 * component test both have their sentences.
 *
 * **Pinned to Dutch.** The English catalog is bundled beside it (T96), and nothing
 * chooses it yet: no **Language switch** and no browser rule is wired until T97.
 * This file has no React in it, so the worker's bundle does not carry any;
 * `./react` is the half that does.
 *
 * Values are not escaped: React escapes what it renders, and an ad titled
 * "Tafel & stoelen" must read that way in a tooltip.
 */
export const words = createInstance();
void words.init({
  lng: DUTCH,
  fallbackLng: DUTCH,
  resources: { nl: { translation: nl }, en: { translation: en } },
  interpolation: { escapeValue: false, defaultVariables: { brand: __BRAND_NAME__ } },
  initAsync: false,
});

/** A sentence in the Language on screen, for the code that is not a component. */
export const t = words.t;

/** The Language on screen, for the plan sentences `@mprelist/contracts` words. */
export function language(): Language {
  return words.language === "en" ? "en" : DUTCH;
}

/**
 * A link to the site, carrying the Language on screen as `?lang` — the hand-off
 * that sets the site's choice (ADR-0043). Asked when the link is drawn, so it
 * follows a change of Language without a reload.
 */
export function onTheSite(url: string): string {
  const link = new URL(url);
  link.searchParams.set("lang", language());
  return link.toString();
}
