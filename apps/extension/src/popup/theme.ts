import type { Theme } from "@mprelist/ui";

/**
 * The popup's light/dark choice: what was chosen, and where it is kept.
 *
 * **Nothing chosen is a state, and the default.** A reader who has never touched
 * the switch gets the browser's theme, as the popup always has — `themeCss`'s
 * `prefers-color-scheme` block. The switch pins `data-mp-theme` on the document
 * element, which that sheet already lets beat the system in both directions.
 *
 * **`localStorage`, not `chrome.storage`.** The choice has to be on the document
 * before the first paint, or a dark popup opens with a white flash every time,
 * and `chrome.storage` can only answer after one. The popup is an extension page
 * with its own origin, so this store is the extension's and survives a restart.
 * It is also the popup's alone: the page button is pinned light to sit on
 * Marktplaats's white page (`hosts.ts`), and the worker has no theme.
 */
export const THEME_KEY = "mprelist.theme";

/** The slice of `Storage` this needs, so a test hands it a plain object. */
export type ThemeStore = Pick<Storage, "getItem" | "setItem">;

/** What was chosen, or `null` when nothing was — or when the store cannot be read. */
export function storedTheme(store: ThemeStore | undefined): Theme | null {
  try {
    const value = store?.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    // A profile with site data blocked throws on access. No choice is the answer.
    return null;
  }
}

/** The theme on screen: the choice if there is one, the system's otherwise. */
export function effectiveTheme(chosen: Theme | null, systemIsDark: boolean): Theme {
  return chosen ?? (systemIsDark ? "dark" : "light");
}

export function otherTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/** Pins the document to a theme and remembers it. A store that refuses still themes this popup. */
export function chooseTheme(theme: Theme, root: HTMLElement, store: ThemeStore | undefined): void {
  root.setAttribute("data-mp-theme", theme);
  try {
    store?.setItem(THEME_KEY, theme);
  } catch {
    // Kept for as long as the popup is open, which is all that can be done.
  }
}

/** Before the first render: put a remembered choice on the document. */
export function applyStoredTheme(root: HTMLElement, store: ThemeStore | undefined): void {
  const chosen = storedTheme(store);
  if (chosen) root.setAttribute("data-mp-theme", chosen);
}
