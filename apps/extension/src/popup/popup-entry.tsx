import { createRoot } from "react-dom/client";

import { chromeLanguageSource, followLanguage } from "../i18n/choice";
import { words } from "../i18n/words";
import { Popup } from "./Popup";
import { applyStoredTheme } from "./theme";
import { workerPort } from "./worker-port";

/**
 * The popup's entry point, and the only file in it that touches Chrome or the
 * DOM. Everything above it is a function of what the worker answered.
 *
 * Named for what it is rather than for what it emits — `scripts/build.mjs` maps
 * it to `popup.js`, the way `service-worker.ts` becomes `background.js`. It also
 * cannot be `popup.tsx` beside `Popup.tsx`: two files whose names differ only in
 * case are one file on a case-insensitive checkout, and TypeScript refuses the
 * pair rather than letting the difference be a machine's.
 */
// Before anything renders: a remembered light/dark choice goes on the document
// now, so the popup never opens in the other theme and then flips.
try {
  applyStoredTheme(document.documentElement, localStorage);
} catch {
  // No store to read; the popup follows the browser.
}

const root = document.getElementById("root");
if (!root) throw new Error("popup.html has no #root to render into");

// The Language is read before the first render, for the theme's reason: a popup
// that opened in Dutch and then turned English would flicker every time. It is
// one `chrome.storage` read (`../i18n/choice.ts` says why there, not
// `localStorage`), and `<html lang>` follows it from here on.
words.on("languageChanged", (language) => document.documentElement.setAttribute("lang", language));
void followLanguage(chromeLanguageSource()).then(() => {
  document.documentElement.setAttribute("lang", words.language);
  createRoot(root).render(<Popup worker={workerPort()} />);
});
