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
 *
 * **The palette was re-cut in 2026-08**, on the canvas first and then here. What
 * it replaced was the POC popup's own colours, lifted verbatim when there was one
 * screen and nothing else: a warm grey ramp, a mid-blue accent, and a dark theme
 * that was Chrome's. Three things were missing rather than wrong — a fill quieter
 * than a surface and louder than nothing (`subtle`), a focus ring (`ring`, and
 * until it existed no control on either surface showed keyboard focus at all), and
 * a resting elevation beside the lifted one (`shadow-sm`).
 */

/** The two themes. Dark is not an afterthought — today's POC popup already has one. */
export type Theme = "light" | "dark";

/**
 * The themed values. `shadow` and `shadow-sm` are not colours and ride here
 * anyway, because they are themed: the light elevations are a grey wash and the
 * dark ones are near-black, and a shadow left behind when the palette flips is a
 * card floating on nothing. `ring` is here for the same reason and one more — it
 * is the accent at low alpha, so it moves whenever the accent does.
 */
export type PaletteName =
  | "bg"
  | "fg"
  | "muted"
  | "line"
  | "hover"
  | "subtle"
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
  | "ring"
  | "shadow-sm"
  | "shadow";

export const palette: Record<Theme, Record<PaletteName, string>> = {
  light: {
    bg: "#ffffff",
    fg: "#0f172a",
    muted: "#64748b",
    line: "#e2e8f0",
    // The fill under a pointer. Quieter than `subtle` is *louder* would be the
    // wrong way round — `hover` is the stronger of the two, so a row that is
    // hovered inside a table whose head is `subtle` still reads as the hovered one.
    hover: "#f1f5f9",
    // A fill for something that is structurally not a surface: a table head, an
    // input, a code chip. The one token that stops those reaching for `hover` and
    // then having nothing left to change under the pointer.
    subtle: "#f8fafc",
    accent: "#2563eb",
    "accent-hover": "#1d4ed8",
    "on-accent": "#ffffff",
    ok: "#15803d",
    "ok-bg": "#f0fdf4",
    warn: "#b45309",
    "warn-bg": "#fffbeb",
    err: "#b91c1c",
    // New in the canvas, and the one place it corrects the POC rather than copying
    // it: popup.html renders error notes on the *warning* background.
    "err-bg": "#fef2f2",
    disabled: "#94a3b8",
    // The page behind a surface. The popup never shows it — it is the whole
    // viewport — but `apps/web` (T50) is cards on a page, and so is the canvas.
    stage: "#eef2f6",
    // The accent at low alpha, and never anything else: a focus ring that is not
    // the accent is a second accent nobody chose.
    ring: "rgba(37,99,235,.32)",
    // Two elevations, because a design with one has to choose between a card that
    // floats when it is only sitting there and a dialog that does not lift at all.
    "shadow-sm": "0 1px 2px rgba(15,23,42,.06)",
    shadow: "0 1px 3px rgba(15,23,42,.08), 0 8px 24px rgba(15,23,42,.08)",
  },
  dark: {
    // Not the light theme inverted. The surface is a cool near-black with the page
    // *darker* than the card, which is the arrangement that makes elevation read
    // at all in the dark — a shadow under a card cannot be seen, a lighter card on
    // a darker page can.
    bg: "#14181f",
    fg: "#e6eaf2",
    muted: "#97a1b3",
    line: "#262c36",
    hover: "#1c2230",
    subtle: "#1a1f29",
    accent: "#60a5fa",
    "accent-hover": "#93c5fd",
    // Dark text on a light accent, which is the contrast that works when the
    // accent has to be light enough to be seen against `bg`.
    "on-accent": "#0b1220",
    ok: "#4ade80",
    "ok-bg": "#0f2419",
    warn: "#fbbf24",
    "warn-bg": "#2a2110",
    err: "#fb7185",
    "err-bg": "#2b1418",
    disabled: "#4c566a",
    stage: "#0b0e13",
    ring: "rgba(96,165,250,.36)",
    "shadow-sm": "0 1px 2px rgba(0,0,0,.5)",
    shadow: "0 1px 3px rgba(0,0,0,.6), 0 12px 28px rgba(0,0,0,.45)",
  },
};

/**
 * The unthemed tokens: one family, the type steps, the spacing step, the radii and
 * this design's motion.
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

/** Monospace, for the one kind of value that has to be read character by character. */
export const monoFamily = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';

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
  // The page heading, and the one step added after the sheet was drawn (T50, #81).
  // The Type sheet is the popup's scale and tops out at 15.5px, because until
  // `apps/web` existed nothing in this product was bigger than a 360px panel; the
  // `Success` and `Cancel` artboards draw their heading at 24px on an 824px card.
  // It lives here rather than as a `font-size` in one page's rules for the reason
  // the note above gives — a size kept in a component is a scale nobody agreed to.
  display: "650 24px/1.25",
  // The small capitals over a table column or a field. It was a bare `font-size:
  // 11.5px` in `admin-styles.ts` before this, which is exactly the seventh scale
  // the note above is about — and it is now the same step on both surfaces.
  label: "650 11.5px/1.4",
} as const;

/**
 * The sheet's step: "gaps on a 6 / 9 / 14 / 20 step". 14 is also the popup's
 * horizontal padding. `xl` is the fifth, for the space between sections of a page
 * rather than between parts of a control — the popup never needed one because it
 * is a single column 360px wide.
 */
export const space = {
  xs: "6px",
  sm: "9px",
  md: "14px",
  lg: "20px",
  xl: "28px",
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
 * The spinner, which was the whole of this design's motion, and the two tokens
 * that make a state change look like one rather than like a repaint.
 *
 * `fast` is short on purpose: a hover that takes longer than about 150ms reads as
 * lag rather than as polish, and every rule that uses it is a colour change under
 * a pointer. Nothing here animates layout.
 *
 * The reduced spin is not "no animation": a still ring reads as a hung control, so
 * it slows down instead — which is what the POC popup and the canvas both already
 * do. Every *other* transition is dropped outright under reduced motion, which the
 * component sheet does in one rule.
 */
export const motion = {
  spin: "0.7s",
  spinReduced: "2s",
  fast: "120ms",
  ease: "cubic-bezier(.2, .6, .3, 1)",
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
  "font-mono": monoFamily,
  ...prefixed("text", text),
  ...prefixed("space", space),
  ...prefixed("radius", radius),
  spin: motion.spin,
  "spin-reduced": motion.spinReduced,
  fast: motion.fast,
  ease: motion.ease,
};

function prefixed(group: string, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [`${group}-${key}`, value]));
}
