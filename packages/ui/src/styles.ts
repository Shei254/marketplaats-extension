import { themeCss } from "./theme";

/**
 * The component rules. Written as CSS text rather than as inline style objects
 * for two reasons that both come from where this has to run: `:hover`,
 * `:disabled` and `@keyframes` cannot be expressed inline at all, and a string is
 * the one form that adopts cleanly into the shadow root T41 (#50) injects on
 * marktplaats.nl — where a stylesheet fetched by URL is an extra web-accessible
 * resource and a bundler CSS pipeline is a third build to keep in step.
 *
 * Every colour in here is a `var(--mp-…)`; not one is a literal. `styles.test.ts`
 * asserts both halves of that — no stray hex, and no reference to a property the
 * theme does not declare, which is the failure that renders transparent rather
 * than loudly.
 *
 * <h2>What the 2026-08 pass changed</h2>
 *
 * The vocabulary grew rather than moved: `Button`, `IconButton`, `Note`,
 * `Skeleton` and `Spinner` keep their class names and their meanings, and what
 * arrived beside them — `Badge`, `Card`, `Field`, `Input`, `Select`, `Checkbox`,
 * `Meter`, `.mp-table` — is the set both surfaces had been spelling for
 * themselves. The admin corner's pills, its table and its form fields were three
 * of those spelled once each in `admin-styles.ts`; the popup's plan-card pill was
 * a fourth. A component two screens have written twice is a component.
 *
 * Three things are new to the design rather than to this package:
 *
 * <ul>
 * <li><strong>Focus is visible.</strong> Nothing here showed keyboard focus
 * before — the search box's outline was the whole of it — so every control now
 * takes the same ring, and it is one rule rather than a decision per component.
 * <li><strong>State changes are transitions.</strong> Colour, shadow and — since
 * the primary button became a gradient, which cannot cross-fade — brightness. Only
 * `--mp-fast`, and dropped entirely under `prefers-reduced-motion`: a hover that
 * takes longer than that reads as lag, and one that snaps reads as a repaint.
 * <li><strong>Two elevations.</strong> A resting card is `--mp-shadow-sm`; the
 * lifted one is what it always was.
 * </ul>
 */
export const componentCss = `
/* Root — the surface a screen is drawn on. */
.mp-root {
  font: var(--mp-text-body) var(--mp-font-family);
  color: var(--mp-fg);
  background: var(--mp-bg);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.mp-root *,
.mp-root *::before,
.mp-root *::after { box-sizing: border-box; }

/* Focus, once, for everything this package ships that can take it.

   The visible part is the ring; the outline is transparent on purpose, so that a
   forced-colours mode — where box-shadows are dropped — still has an outline to
   paint. A control that shows nothing on :focus-visible is unusable by keyboard
   and looks identical to one that works. */
.mp-btn:focus-visible,
.mp-icon-btn:focus-visible,
.mp-input:focus-visible,
.mp-select:focus-visible,
.mp-textarea:focus-visible,
.mp-check:focus-visible,
.mp-link:focus-visible {
  outline: 2px solid transparent;
  outline-offset: 2px;
  box-shadow: 0 0 0 3px var(--mp-ring);
}

/* Button — the shape says how big, the tone says what state the action is in. */
.mp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--mp-space-xs);
  flex: none;
  box-sizing: border-box;
  border: 1px solid transparent;
  font: var(--mp-text-control) var(--mp-font-family);
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--mp-fast) var(--mp-ease),
    border-color var(--mp-fast) var(--mp-ease),
    color var(--mp-fast) var(--mp-ease),
    filter var(--mp-fast) var(--mp-ease),
    box-shadow var(--mp-fast) var(--mp-ease);
}
.mp-btn--pill { padding: 5px 12px; border-radius: var(--mp-radius-pill); }
.mp-btn--rect { padding: 7px 14px; border-radius: var(--mp-radius-block); }
.mp-btn--block {
  width: 100%;
  padding: 10px var(--mp-space-md);
  border-radius: var(--mp-radius-block);
  font: var(--mp-text-control-large) var(--mp-font-family);
}

/* The primary tone is the one gradient in the system that is not a shimmer, and
   the two stops are the two accents we already have. That is worth stating,
   because the names now say something the rule does not: \`--mp-accent-hover\` is a
   **rest** stop here, and \`:hover\` no longer touches the background at all.

   It has to be that way round. A gradient is \`background-image\`, and
   \`background-image\` does not interpolate in any browser — so a hover that swapped
   one gradient for another would snap where this control has always faded. What
   hover changes instead is the two things that *do* interpolate: the elevation it
   already owned, and brightness. The button lifts rather than repaints.

   \`background-color\` is spelled separately from \`background-image\` rather than
   folded into one \`background\`, so there is a solid accent underneath the ramp for
   the forced-colours rule at the foot of this sheet to fall back to.

   The ramp runs corner to corner, which is a decision with two visible costs taken
   knowingly: the two accents sit on opposite sides of the neutral in the two
   themes, so the light button darkens towards its bottom-right and the dark one
   lightens towards it; and a 135deg ramp reads as more horizontal the wider the
   control, so a \`pill\` in a row and a \`block\` in the foot are not lit identically.
   Both are cured by an \`--accent-grad\` token drawn on the canvas per theme, which
   is where to start if either one ever grates. */
.mp-btn--primary {
  color: var(--mp-on-accent);
  background-color: var(--mp-accent);
  background-image: linear-gradient(135deg, var(--mp-accent), var(--mp-accent-hover));
  box-shadow: var(--mp-shadow-sm);
}
.mp-btn--primary:hover:not(:disabled) {
  filter: brightness(1.06);
  box-shadow: var(--mp-shadow);
}
.mp-btn--secondary {
  color: var(--mp-fg);
  background: var(--mp-bg);
  border-color: var(--mp-line);
  box-shadow: var(--mp-shadow-sm);
}
.mp-btn--secondary:hover:not(:disabled) { background: var(--mp-hover); }
/* The quiet one: a text button that is a button. Both surfaces had written it for
   themselves — \`popup-quiet\` in the header, \`admin-who\` beside the brand. */
.mp-btn--ghost { color: var(--mp-muted); background: none; }
.mp-btn--ghost:hover:not(:disabled) { color: var(--mp-fg); background: var(--mp-hover); }
.mp-btn--retry { color: var(--mp-on-accent); background: var(--mp-warn); }
/* Locked and busy read as unavailable rather than as broken: a quiet chip with the
   lock or the spinner in it, not a grey slab where a blue button was. */
.mp-btn--locked,
.mp-btn--busy,
.mp-btn--cooldown {
  color: var(--mp-muted);
  background: var(--mp-subtle);
  border-color: var(--mp-line);
}
.mp-btn--done { color: var(--mp-ok); background: var(--mp-ok-bg); }
.mp-btn:disabled { cursor: default; }
/* A tone that *is* a state carries its own colours; a pressable tone that has been
   disabled for a moment — a form saving, a header waiting on a reload — fades. */
.mp-btn--primary:disabled,
.mp-btn--secondary:disabled,
.mp-btn--ghost:disabled,
.mp-btn--retry:disabled { opacity: 0.55; box-shadow: none; }

/* Icon button — the popup header's refresh, and nothing heavier. */
.mp-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 6px;
  border: 0;
  border-radius: var(--mp-radius-block);
  background: none;
  color: var(--mp-muted);
  cursor: pointer;
  transition:
    background-color var(--mp-fast) var(--mp-ease),
    color var(--mp-fast) var(--mp-ease);
}
.mp-icon-btn:hover:not(:disabled) { color: var(--mp-fg); background: var(--mp-hover); }
.mp-icon-btn:disabled { color: var(--mp-disabled); cursor: default; }

/* Badge — a word about a thing, in the colour of what it means. */
.mp-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: var(--mp-radius-pill);
  font: var(--mp-text-micro) var(--mp-font-family);
  font-weight: 650;
  color: var(--mp-muted);
  background: var(--mp-subtle);
  border: 1px solid var(--mp-line);
  white-space: nowrap;
}
.mp-badge--accent { color: var(--mp-accent); background: var(--mp-hover); border-color: transparent; }
.mp-badge--ok { color: var(--mp-ok); background: var(--mp-ok-bg); border-color: transparent; }
.mp-badge--warn { color: var(--mp-warn); background: var(--mp-warn-bg); border-color: transparent; }
.mp-badge--err { color: var(--mp-err); background: var(--mp-err-bg); border-color: transparent; }

/* Card — a surface with an edge, which is what a page of sections is made of. */
.mp-card {
  background: var(--mp-bg);
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-card);
  box-shadow: var(--mp-shadow-sm);
}
.mp-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mp-space-md);
  padding: var(--mp-space-md) var(--mp-space-lg);
  border-bottom: 1px solid var(--mp-line);
}
.mp-card-title {
  margin: 0;
  font: var(--mp-text-title) var(--mp-font-family);
  letter-spacing: -0.01em;
}
.mp-card-lede {
  margin: 3px 0 0;
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
  max-width: 68ch;
}
.mp-card-body { padding: var(--mp-space-lg); }
/* A table fills its card to the edges; the head above it has already said what it is. */
.mp-card-body--flush { padding: 0; }

/* Fields — a label, a control, and the sentence under it that explains the rule. */
.mp-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.mp-label {
  font: var(--mp-text-caption) var(--mp-font-family);
  font-weight: 600;
  color: var(--mp-fg);
}
.mp-input,
.mp-select,
.mp-textarea {
  width: 100%;
  font: var(--mp-text-body) var(--mp-font-family);
  color: var(--mp-fg);
  background: var(--mp-bg);
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-block);
  padding: 8px 10px;
  transition:
    border-color var(--mp-fast) var(--mp-ease),
    box-shadow var(--mp-fast) var(--mp-ease);
}
.mp-input:hover:not(:disabled),
.mp-select:hover:not(:disabled),
.mp-textarea:hover:not(:disabled) { border-color: var(--mp-disabled); }
.mp-input:focus-visible,
.mp-select:focus-visible,
.mp-textarea:focus-visible { border-color: var(--mp-accent); }
.mp-input::placeholder,
.mp-textarea::placeholder { color: var(--mp-muted); }
.mp-input:disabled,
.mp-select:disabled,
.mp-textarea:disabled { color: var(--mp-muted); background: var(--mp-subtle); cursor: default; }
.mp-textarea { min-height: 72px; font-family: var(--mp-font-mono); font-size: 12.5px; resize: vertical; }
/* The native control, told what colour it is. A hand-drawn one would be a second
   keyboard implementation to get right. */
.mp-check {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--mp-accent);
  cursor: pointer;
}
.mp-check-row { display: flex; align-items: center; gap: var(--mp-space-xs); }
.mp-hint {
  margin: 0;
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-muted);
  line-height: 1.5;
}

/* Table — rows of one shape, read down a column. */
.mp-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font: var(--mp-text-secondary) var(--mp-font-family);
}
.mp-table th {
  text-align: left;
  font: var(--mp-text-label) var(--mp-font-family);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--mp-muted);
  background: var(--mp-subtle);
  padding: 9px var(--mp-space-md);
  border-bottom: 1px solid var(--mp-line);
  white-space: nowrap;
}
.mp-table td {
  padding: 11px var(--mp-space-md);
  border-bottom: 1px solid var(--mp-line);
  vertical-align: middle;
}
.mp-table tbody tr:last-child td { border-bottom: 0; }
.mp-table tbody tr { transition: background-color var(--mp-fast) var(--mp-ease); }
.mp-table tbody tr:hover td { background: var(--mp-hover); }
/* Digits being compared down a column line up, which is the whole reason a table
   was chosen over a list. */
.mp-numeric { font-variant-numeric: tabular-nums; }

/* Code — an identifier that has to be read character by character. */
.mp-code {
  font-family: var(--mp-font-mono);
  font-size: 11.5px;
  color: var(--mp-muted);
  background: var(--mp-subtle);
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-note);
  padding: 1px 5px;
}

/* An identifier inside a sentence, which is most of them: the hints under a field
   and the ledes over a section both name Stripe ids and metadata keys, and those
   are read character by character wherever they appear. */
.mp-hint code,
.mp-card-lede code {
  font-family: var(--mp-font-mono);
  font-size: 0.94em;
  color: var(--mp-fg);
}

/* Meter — how much of something is left, in the width of a bar. */
.mp-meter {
  display: block;
  width: 100%;
  height: 4px;
  border-radius: var(--mp-radius-pill);
  background: var(--mp-line);
  overflow: hidden;
}
.mp-meter-fill {
  display: block;
  height: 100%;
  border-radius: var(--mp-radius-pill);
  background: var(--mp-accent);
  transition: width var(--mp-fast) var(--mp-ease);
}
.mp-meter--warn .mp-meter-fill { background: var(--mp-warn); }
.mp-meter--err .mp-meter-fill { background: var(--mp-err); }

/* Link — the only text in this product that is not a control and still reacts. */
.mp-link { color: var(--mp-accent); text-decoration: none; border-radius: var(--mp-radius-note); }
.mp-link:hover { text-decoration: underline; }

/* Spinner — this design's oldest motion. */
.mp-spinner {
  display: inline-block;
  box-sizing: border-box;
  width: 11px;
  height: 11px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: mp-spin var(--mp-spin) linear infinite;
}
.mp-spinner--lg { width: 22px; height: 22px; border-width: 2.5px; }
@keyframes mp-spin { to { transform: rotate(360deg); } }

/* Note — the line under a row that says what just happened. */
.mp-note {
  box-sizing: border-box;
  margin: 8px 0 2px;
  padding: 8px var(--mp-space-sm);
  border-radius: var(--mp-radius-note);
  font: var(--mp-text-caption) var(--mp-font-family);
}
.mp-note--ok { color: var(--mp-ok); background: var(--mp-ok-bg); }
.mp-note--warn { color: var(--mp-warn); background: var(--mp-warn-bg); }
.mp-note--error { color: var(--mp-err); background: var(--mp-err-bg); }

/* Skeleton — a shape where content will be, moving just enough to say it is coming. */
.mp-skeleton {
  display: block;
  box-sizing: border-box;
  background: var(--mp-line);
  background-image: linear-gradient(90deg, var(--mp-line), var(--mp-subtle), var(--mp-line));
  background-size: 200% 100%;
  border-radius: var(--mp-radius-skeleton);
  animation: mp-shimmer 1.4s linear infinite;
}
.mp-skeleton--pill { border-radius: var(--mp-radius-pill); }
@keyframes mp-shimmer { to { background-position: -200% 0; } }

@media (prefers-reduced-motion: reduce) {
  /* Every transition goes; the two animations are decided one at a time. A still
     ring reads as a control that has hung, so the spinner slows down instead —
     which is what the POC popup and the canvas both already do. A still shimmer
     says nothing at all, so it stops. */
  .mp-root *,
  .mp-root *::before,
  .mp-root *::after { transition-duration: 1ms; }
  .mp-spinner { animation-duration: var(--mp-spin-reduced); }
  .mp-skeleton { animation: none; }
}

@media (forced-colors: active) {
  /* Forced colours overrides \`background-color\` and \`color\` and leaves
     \`background-image\` painting, so the ramp would survive underneath text the
     system has just recoloured for contrast. Dropping it puts this control back to
     the flat fill it had before there was a gradient, which is the one thing a
     reader in this mode asked for. */
  .mp-btn--primary { background-image: none; }
}
`.trim();

/**
 * Everything a surface needs, in one string: the properties and the rules that
 * read them. Consumers inject this once — `<UiStyles />` in React, a `<style>` in
 * a plain page, `adoptedStyleSheets` in a shadow root.
 */
export const uiCss = `${themeCss}\n\n${componentCss}`;
