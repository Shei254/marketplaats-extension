import { Icon, IconButton, type Theme } from "@mprelist/ui";
import { useState, type JSX } from "react";

import { chooseTheme, effectiveTheme, otherTheme, storedTheme, type ThemeStore } from "./theme";

/** `localStorage`, or nothing where reaching for it throws or there is no window. */
function themeStore(): ThemeStore | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function themeOnScreen(): Theme {
  const systemIsDark =
    typeof globalThis.matchMedia === "function" && globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
  return effectiveTheme(storedTheme(themeStore()), systemIsDark);
}

/**
 * The header's light/dark switch (`theme.ts` says where the choice lives).
 *
 * It shows the theme a press leads to — a moon in the light, a sun in the dark —
 * and is named for it, so the label and the glyph say the same thing. It is in
 * the header on every screen, signed out included: the theme is the popup's, not
 * the account's.
 */
export function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = useState<Theme>(themeOnScreen);
  const next = otherTheme(theme);
  return (
    <IconButton
      label={next === "dark" ? "Donkere modus" : "Lichte modus"}
      title={next === "dark" ? "Donkere modus" : "Lichte modus"}
      onClick={() => {
        chooseTheme(next, document.documentElement, themeStore());
        setTheme(next);
      }}
    >
      <Icon name={next === "dark" ? "moon" : "sun"} />
    </IconButton>
  );
}
