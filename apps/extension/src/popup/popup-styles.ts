/**
 * The popup's own rules — the header, the plan strip, and the two centred screens.
 *
 * Everything a *control* needs comes from `@mprelist/ui`; what is here is layout
 * for this one surface, which no other consumer of that package has. Same shape
 * as the package's own stylesheet — a string, injected once — so there is still
 * no CSS pipeline in a bundle that has to run in a Chrome popup and, later, in a
 * shadow root on somebody else's page.
 *
 * Every colour is a `var(--mp-…)`: the tokens are the design canvas's, and a
 * literal here would be this file quietly deciding one for itself.
 */
export const popupCss = `
body {
  margin: 0;
  /* Chrome sizes a popup to its content; the width is ours to state, and 360px
     is what the canvas draws every artboard at. */
  width: 360px;
  background: var(--mp-bg);
}

.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mp-space-sm);
  padding: 12px var(--mp-space-md);
  border-bottom: 1px solid var(--mp-line);
}
.popup-brand {
  display: flex;
  align-items: center;
  gap: var(--mp-space-sm);
  min-width: 0;
  font: var(--mp-text-title) var(--mp-font-family);
  letter-spacing: -0.01em;
}
.popup-mark { display: inline-flex; color: var(--mp-accent); }
.popup-actions { display: flex; align-items: center; gap: 2px; }

/* The one control the design system does not carry: a quiet text button, which is
   what the POC's own header used and what sign-out has to be beside a glyph. */
.popup-quiet {
  border: 0;
  background: none;
  padding: 5px 6px;
  border-radius: var(--mp-radius-note);
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
  cursor: pointer;
}
.popup-quiet:hover:not(:disabled) { background: var(--mp-hover); color: var(--mp-fg); }
.popup-quiet:disabled { cursor: default; opacity: 0.6; }

/* The plan strip: what you are on, what is left, and when it comes back. */
.popup-plan {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mp-space-sm);
  padding: var(--mp-space-sm) var(--mp-space-md);
  border-bottom: 1px solid var(--mp-line);
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
}
.popup-plan b { color: var(--mp-fg); font-weight: 650; }
.popup-plan--spent { background: var(--mp-warn-bg); color: var(--mp-warn); }

/* The screens with nothing but a message on them. */
.popup-centred { padding: 34px 26px 30px; text-align: center; }
.popup-badge {
  width: 46px;
  height: 46px;
  margin: 0 auto var(--mp-space-md);
  border-radius: var(--mp-radius-card);
  background: var(--mp-accent);
  color: var(--mp-on-accent);
  display: flex;
  align-items: center;
  justify-content: center;
}
.popup-warning { color: var(--mp-warn); display: flex; justify-content: center; margin-bottom: var(--mp-space-md); }
.popup-title {
  margin: 0 0 var(--mp-space-sm);
  font: 650 16.5px/1.3 var(--mp-font-family);
  letter-spacing: -0.01em;
}
.popup-copy {
  margin: 0 0 var(--mp-space-lg);
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
}
.popup-micro {
  margin: var(--mp-space-md) 0 0;
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-muted);
}
`.trim();

/**
 * The ad list (T30a, #39). Appended as a second string rather than folded into
 * the one above so that what the shell needs and what the list needs stay legible
 * apart — the rows are the part T30b (#79) will add a button and a note to.
 */
export const adListCss = `
.popup-ads { list-style: none; margin: 0; padding: 0; max-height: 420px; overflow-y: auto; }
.popup-ad {
  padding: 10px var(--mp-space-md);
  border-bottom: 1px solid var(--mp-line);
}
.popup-ad:last-child { border-bottom: 0; }
.popup-ad-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.popup-ad-info { min-width: 0; }
.popup-ad-title {
  display: block;
  font: var(--mp-text-body) var(--mp-font-family);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.popup-ad-price {
  display: block;
  margin-top: 2px;
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
  font-variant-numeric: tabular-nums;
}
.popup-ads-empty {
  padding: 28px var(--mp-space-md);
  text-align: center;
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
}
.popup-ads-failed { padding: 10px var(--mp-space-md) var(--mp-space-md); }
`.trim();
