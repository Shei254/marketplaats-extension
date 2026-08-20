/**
 * The tokens, and the only place in this repository a colour is written down.
 *
 * Every value here is lifted from the design canvas — `docs/design/Tokens.dc.html`,
 * the sheet ADR-0016 has drawn before this package exists so that the design
 * language is a decision rather than whatever the first screen happened to need.
 * `tokens.test.ts` holds the palette to that file rather than to a copy of it, so
 * re-seeding the canvas with a different accent is a change the suite notices.
 *
 * Names are namespaced (`--mp-…`, `.mp-…`) and the values are not. That asymmetry
 * is deliberate: the values are the canvas's, but the properties have to survive
 * being injected into a stranger's page (T41, #50), where a bare `--accent` or a
 * bare `.note` is a collision waiting to happen.
 */

/** The two themes. Dark is not an afterthought — today's POC popup already has one. */
export type Theme = "light" | "dark";

/**
 * The themed values. `shadow` is not a colour and rides here anyway, because it
 * is themed: the light elevation is a grey wash and the dark one is near-black,
 * and a shadow left behind when the palette flips is a card floating on nothing.
 */
export type PaletteName =
  | "bg"
  | "fg"
  | "muted"
  | "line"
  | "hover"
  | "accent"
  | "accent-hover"
  | "on-accent"
  | "ok"
  | "ok-bg"
  | "warn"
  | "warn-bg"
  | "err"
  | "err-bg"
  | "disabled"
  | "stage"
  | "shadow";

export const palette: Record<Theme, Record<PaletteName, string>> = {
  light: {
    bg: "#ffffff",
    fg: "#1a1a1a",
    muted: "#6b7280",
    line: "#ececec",
    hover: "#f7f8fa",
    accent: "#0a5fd6",
    "accent-hover": "#0b4fb0",
    "on-accent": "#ffffff",
    ok: "#0a7d28",
    "ok-bg": "#e8f6ec",
    warn: "#a15c00",
    "warn-bg": "#fdf3e2",
    err: "#c02626",
    // New in the canvas, and the one place it corrects the POC rather than copying
    // it: popup.html renders error notes on the *warning* background.
    "err-bg": "#fdecec",
    disabled: "#a5abb5",
    // The page behind a surface. The popup never shows it — it is the whole
    // viewport — but `apps/web` (T50) is cards on a page, and so is the canvas.
    stage: "#eceef1",
    shadow: "0 1px 2px rgba(16,19,26,.08), 0 8px 24px rgba(16,19,26,.10)",
  },
  dark: {
    bg: "#202124",
    fg: "#e8eaed",
    muted: "#9aa0a6",
    line: "#34363a",
    hover: "#26282c",
    accent: "#4285f4",
    "accent-hover": "#5b96f7",
    "on-accent": "#10131a",
    ok: "#6dd58c",
    "ok-bg": "#1d2b21",
    warn: "#e8b558",
    "warn-bg": "#2e2617",
    err: "#f28b82",
    "err-bg": "#2e1b1b",
    disabled: "#5f6368",
    stage: "#17181a",
    shadow: "0 1px 2px rgba(0,0,0,.5), 0 8px 24px rgba(0,0,0,.45)",
  },
};

/**
 * The unthemed tokens: one family, six type steps, the spacing step, the radii and
 * the one duration this design has.
 *
 * The type steps are the sheet's five — title, body, secondary, caption, micro —
 * plus `control`, which is the size every button on the sheet is drawn at. It is
 * listed under Controls there rather than under Type; it is a step all the same,
 * and a font size that lives in a component instead of here is a seventh scale
 * nobody agreed to.
 *
 * Each step is a `font` shorthand *without* the family, so a rule reads
 * `font: var(--mp-text-body) var(--mp-font-family)` and a caller cannot take the
 * size while forgetting the weight.
 */
export const fontFamily = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export const text = {
  title: "650 15.5px/1.3",
  body: "400 14px/1.45",
  secondary: "400 13px/1.5",
  caption: "400 12.5px/1.4",
  micro: "400 11.5px/1.5",
  control: "600 13.5px/1.2",
  // The full-width sign-in button is drawn a half-point larger than the row
  // controls it shares a sheet with. Kept rather than rounded away, because the
  // alternative is a component that quietly redecides a size the canvas set.
  "control-large": "600 14px/1.2",
} as const;

/** The sheet's step: "gaps on a 6 / 9 / 14 / 20 step". 14 is also the popup's horizontal padding. */
export const space = {
  xs: "6px",
  sm: "9px",
  md: "14px",
  lg: "20px",
} as const;

/**
 * "Radii 6px notes · 8px blocks · 10–12px cards · 999px pills" — cards at the top
 * of that range. `skeleton` is the fifth: the canvas draws loading bars at 4px,
 * under everything the sheet names, and a rounder one reads as a pill.
 */
export const radius = {
  skeleton: "4px",
  note: "6px",
  block: "8px",
  card: "12px",
  pill: "999px",
} as const;

/**
 * The spinner, which is the whole of this design's motion. The reduced value is
 * not "no animation": a still ring reads as a hung control, so it slows down
 * instead — which is what the POC popup and the canvas both already do.
 */
export const motion = {
  spin: "0.7s",
  spinReduced: "2s",
} as const;

/** The custom property a token is emitted as. One function, so no rule spells a name by hand. */
export function cssVarName(token: string): string {
  return `--mp-${token}`;
}

/**
 * The unthemed tokens flattened to the properties they are emitted as, in the
 * order they appear above.
 */
export const staticTokens: Record<string, string> = {
  "font-family": fontFamily,
  ...prefixed("text", text),
  ...prefixed("space", space),
  ...prefixed("radius", radius),
  spin: motion.spin,
  "spin-reduced": motion.spinReduced,
};

function prefixed(group: string, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [`${group}-${key}`, value]));
}
