import { uiCss } from "@mprelist/ui";

/**
 * The **Page button**'s own rules, on top of the design system (ADR-0040).
 *
 * **Native geometry, our accent.** Height, corner, font and width come in as
 * `--pb-*` properties measured off the *Sneller verkopen* button below it
 * (`hosts.ts`), with fallbacks for the moment before the first measurement; every
 * colour is a `--mp-*` token, so the button is ours to look at and theirs to line
 * up with. Outlined rather than filled, because their orange is the call to
 * action in that cell and ours is the quiet alternative beside it.
 *
 * Every state carries its colour on `data-tone`, the popup's own five tones:
 * busy, done, retry, locked, cooldown. Unlike the popup's `locked`, the page's is
 * still pressable — it opens the card that says why (ADR-0007's refusal as the
 * place a plan is offered).
 */
const pageCss = `
:host { all: initial; }
.pb {
  font-family: var(--pb-font, var(--mp-font-family));
  color: var(--mp-fg);
  -webkit-font-smoothing: antialiased;
}
.pb *, .pb *::before, .pb *::after { box-sizing: border-box; }

/* The mark: our chevron, white on the brand ramp, in a tile — the popup header's
   shape at button size, which is what makes the button recognisably ours. */
.pb-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  color: var(--mp-on-brand);
  background-image: linear-gradient(135deg, var(--mp-brand-from), var(--mp-brand-to));
}
.pb-mark svg { width: 14px; height: 14px; }

.pb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: var(--pb-height, 40px);
  padding: 0 14px;
  border: 1px solid var(--mp-accent);
  border-radius: var(--pb-radius, 8px);
  color: var(--mp-accent);
  background: var(--mp-bg);
  font: inherit;
  font-size: var(--pb-size, 14px);
  font-weight: var(--pb-weight, 600);
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--mp-fast) var(--mp-ease),
    border-color var(--mp-fast) var(--mp-ease),
    color var(--mp-fast) var(--mp-ease),
    box-shadow var(--mp-fast) var(--mp-ease),
    transform var(--mp-fast) var(--mp-ease);
}
.pb-btn:hover:not(:disabled) {
  background: var(--mp-hover);
  box-shadow: 0 4px 14px -6px var(--mp-accent);
  transform: translateY(-1px);
}
.pb-btn:active:not(:disabled) { transform: translateY(0); box-shadow: none; }
.pb-btn:focus-visible,
.pb-link:focus-visible,
.pb-close:focus-visible,
.pb-action:focus-visible {
  outline: 2px solid transparent;
  outline-offset: 2px;
  box-shadow: 0 0 0 3px var(--mp-ring);
}
.pb-btn:disabled { cursor: default; }
.pb-btn svg { flex: none; }

.pb-btn[data-tone="busy"],
.pb-btn[data-tone="cooldown"],
.pb-btn[data-tone="locked"] {
  color: var(--mp-muted);
  border-color: var(--mp-line);
  background: var(--mp-subtle);
}
.pb-btn[data-tone="locked"]:hover:not(:disabled) { color: var(--mp-fg); box-shadow: none; transform: none; }
.pb-btn[data-tone="done"] {
  color: var(--mp-ok);
  border-color: transparent;
  background: var(--mp-ok-bg);
}
.pb-btn[data-tone="retry"] {
  color: var(--mp-warn);
  border-color: var(--mp-warn);
  background: var(--mp-warn-bg);
}
.pb-btn[data-tone="retry"]:hover:not(:disabled) { background: var(--mp-warn-bg); box-shadow: none; }
.pb-btn .mp-spinner { flex: none; width: 14px; height: 14px; }
/* Whatever the label, it ends inside the button: an ellipsis, never an overflow
   that centring pushes past both edges. */
.pb-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pb-count { font-variant-numeric: tabular-nums; }

/* The narrow layout's twin of Marktplaats's own link: words and a glyph, no box. */
.pb-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  border: 0;
  background: none;
  color: var(--mp-accent);
  font: inherit;
  font-size: var(--pb-size, 14px);
  font-weight: 600;
  cursor: pointer;
}
.pb-link:hover:not(:disabled) { text-decoration: underline; text-underline-offset: 3px; }
.pb-link:disabled { cursor: default; }
.pb-link[data-tone="busy"], .pb-link[data-tone="cooldown"], .pb-link[data-tone="locked"] { color: var(--mp-muted); }
.pb-link[data-tone="done"] { color: var(--mp-ok); }
.pb-link[data-tone="retry"] { color: var(--mp-warn); }
.pb-link .pb-mark { width: 16px; height: 16px; border-radius: 5px; }
.pb-link .pb-mark svg { width: 11px; height: 11px; }

/* The card a refusal opens, under the button it is about. */
.pb-card {
  position: fixed;
  width: 304px;
  padding: 14px 16px 16px;
  border: 1px solid var(--mp-line);
  border-radius: 14px;
  background: var(--mp-bg);
  box-shadow: 0 18px 40px -12px rgba(15, 23, 42, 0.28), 0 2px 6px rgba(15, 23, 42, 0.08);
  font-family: var(--mp-font-family);
  animation: pb-rise 160ms var(--mp-ease) both;
}
.pb-card::before {
  content: "";
  position: absolute;
  top: -6px;
  left: var(--pb-caret, 50%);
  width: 10px;
  height: 10px;
  margin-left: -5px;
  border-top: 1px solid var(--mp-line);
  border-left: 1px solid var(--mp-line);
  background: var(--mp-bg);
  transform: rotate(45deg);
}
.pb-card[data-above]::before {
  top: auto;
  bottom: -6px;
  transform: rotate(225deg);
}
.pb-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.01em;
  color: var(--mp-fg);
}
.pb-card-head .pb-brand { flex: 1; }
.pb-card-head[data-tone="warn"] { color: var(--mp-warn); }
.pb-card-head[data-tone="error"] { color: var(--mp-err); }
.pb-close {
  display: inline-flex;
  padding: 4px;
  margin: -4px -6px -4px 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--mp-muted);
  cursor: pointer;
}
.pb-close:hover { color: var(--mp-fg); background: var(--mp-hover); }
.pb-card-text {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--mp-fg);
}
.pb-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 8px 14px;
  border: 0;
  border-radius: 9px;
  color: var(--mp-on-accent);
  background-color: var(--mp-accent);
  background-image: linear-gradient(135deg, var(--mp-accent), var(--mp-accent-hover));
  box-shadow: var(--mp-shadow-sm);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: filter var(--mp-fast) var(--mp-ease), box-shadow var(--mp-fast) var(--mp-ease);
}
.pb-action:hover { filter: brightness(1.06); box-shadow: var(--mp-shadow); }

/* The toast a repost leaves: the ad is at the top now, and the page has not
   noticed until the seller says so. */
.pb-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: calc(100vw - 32px);
  padding: 10px 10px 10px 14px;
  border: 1px solid var(--mp-line);
  border-radius: 999px;
  background: var(--mp-bg);
  box-shadow: 0 18px 40px -12px rgba(15, 23, 42, 0.32), 0 2px 6px rgba(15, 23, 42, 0.08);
  font-family: var(--mp-font-family);
  font-size: 13.5px;
  color: var(--mp-fg);
  transform: translateX(-50%);
  animation: pb-toast 200ms var(--mp-ease) both;
}
.pb-toast-check {
  display: inline-flex;
  padding: 4px;
  border-radius: 999px;
  color: var(--mp-ok);
  background: var(--mp-ok-bg);
}
.pb-toast .pb-action { margin: 0; border-radius: 999px; padding: 7px 14px; }
.pb-toast .pb-close { margin: 0; }

@keyframes pb-rise { from { opacity: 0; transform: translateY(-4px); } }
@keyframes pb-toast { from { opacity: 0; transform: translate(-50%, 8px); } }
@media (prefers-reduced-motion: reduce) {
  .pb-btn, .pb-action { transition: none; }
  .pb-btn:hover:not(:disabled) { transform: none; }
  .pb-card, .pb-toast { animation: none; }
}
`;

export const pageButtonCss = `${uiCss}\n\n${pageCss}`;
