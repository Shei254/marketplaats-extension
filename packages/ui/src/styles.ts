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
 */
export const componentCss = `
/* Root — the surface a screen is drawn on. */
.mp-root {
  font: var(--mp-text-body) var(--mp-font-family);
  color: var(--mp-fg);
  background: var(--mp-bg);
}
.mp-root *,
.mp-root *::before,
.mp-root *::after { box-sizing: border-box; }

/* Button — the shape says how big, the tone says what state the action is in. */
.mp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--mp-space-xs);
  flex: none;
  box-sizing: border-box;
  border: 0;
  font: var(--mp-text-control) var(--mp-font-family);
  cursor: pointer;
}
.mp-btn--pill { padding: 6px 12px; border-radius: var(--mp-radius-pill); }
.mp-btn--rect { padding: 8px 18px; border-radius: var(--mp-radius-block); }
.mp-btn--block {
  width: 100%;
  padding: 10px var(--mp-space-md);
  border-radius: var(--mp-radius-block);
  font: var(--mp-text-control-large) var(--mp-font-family);
}

.mp-btn--primary { color: var(--mp-on-accent); background: var(--mp-accent); }
.mp-btn--primary:hover:not(:disabled) { background: var(--mp-accent-hover); }
.mp-btn--secondary {
  color: var(--mp-fg);
  background: var(--mp-bg);
  border: 1px solid var(--mp-line);
}
.mp-btn--secondary:hover:not(:disabled) { background: var(--mp-hover); }
.mp-btn--retry { color: var(--mp-on-accent); background: var(--mp-warn); }
.mp-btn--locked,
.mp-btn--busy { color: var(--mp-on-accent); background: var(--mp-disabled); }
.mp-btn--done { color: var(--mp-ok); background: var(--mp-ok-bg); }
.mp-btn--cooldown { color: var(--mp-muted); background: var(--mp-hover); }
.mp-btn:disabled { cursor: default; }

/* Icon button — the popup header's refresh, and nothing heavier. */
.mp-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 5px;
  border: 0;
  border-radius: var(--mp-radius-note);
  background: none;
  color: var(--mp-accent);
  cursor: pointer;
}
.mp-icon-btn:hover:not(:disabled) { background: var(--mp-hover); }
.mp-icon-btn:disabled { color: var(--mp-disabled); cursor: default; }

/* Spinner — this design's only motion. */
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
@media (prefers-reduced-motion: reduce) {
  /* Slower, not stopped: a still ring reads as a control that has hung. */
  .mp-spinner { animation-duration: var(--mp-spin-reduced); }
}

/* Note — the line under a row that says what just happened. */
.mp-note {
  box-sizing: border-box;
  margin: 8px 0 2px;
  padding: 7px var(--mp-space-sm);
  border-radius: var(--mp-radius-note);
  font: var(--mp-text-caption) var(--mp-font-family);
}
.mp-note--ok { color: var(--mp-ok); background: var(--mp-ok-bg); }
.mp-note--warn { color: var(--mp-warn); background: var(--mp-warn-bg); }
.mp-note--error { color: var(--mp-err); background: var(--mp-err-bg); }

/* Skeleton — a shape where content will be, on the divider colour. */
.mp-skeleton {
  display: block;
  box-sizing: border-box;
  background: var(--mp-line);
  border-radius: var(--mp-radius-skeleton);
}
.mp-skeleton--pill { border-radius: var(--mp-radius-pill); }
`.trim();

/**
 * Everything a surface needs, in one string: the properties and the rules that
 * read them. Consumers inject this once — `<UiStyles />` in React, a `<style>` in
 * a plain page, `adoptedStyleSheets` in a shadow root.
 */
export const uiCss = `${themeCss}\n\n${componentCss}`;
