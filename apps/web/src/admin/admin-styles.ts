/**
 * The admin corner's own rules (T54, #85).
 *
 * A third string beside the public site's, injected the same way — there is still
 * no CSS pipeline in this build. Every colour is a `var(--mp-…)`: the tokens are
 * the design canvas's, and a literal here would be this file quietly deciding one.
 *
 * **There is no artboard for any of this.** The canvas draws the popup and the
 * public pages; `/admin` is a tool for one person and is drawn out of the same
 * tokens rather than out of a design nobody made. What that buys is that it looks
 * like the rest of the product without pretending to be designed.
 */
export const adminCss = `
.admin-page {
  max-width: 900px;
  margin: 0 auto;
  padding: var(--mp-space-lg) var(--mp-space-md) 48px;
  color: var(--mp-fg);
}
.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mp-space-sm);
  padding-bottom: var(--mp-space-md);
  border-bottom: 1px solid var(--mp-line);
}
.admin-brand { display: flex; align-items: center; gap: var(--mp-space-sm); font-weight: 650; }
.admin-mark { display: inline-flex; color: var(--mp-accent); }
.admin-who { font: var(--mp-text-caption) var(--mp-font-family); color: var(--mp-muted); }

.admin-section { margin-top: var(--mp-space-lg); }
.admin-section-title {
  margin: 0 0 var(--mp-space-xs);
  font: var(--mp-text-title) var(--mp-font-family);
  letter-spacing: -0.01em;
}
.admin-section-lede {
  margin: 0 0 var(--mp-space-md);
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
}

.admin-table { width: 100%; border-collapse: collapse; font: var(--mp-text-secondary) var(--mp-font-family); }
.admin-table th {
  text-align: left;
  font-weight: 650;
  color: var(--mp-muted);
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0 var(--mp-space-sm) var(--mp-space-xs);
  border-bottom: 1px solid var(--mp-line);
}
.admin-table td { padding: 10px var(--mp-space-sm); border-bottom: 1px solid var(--mp-line); }
.admin-table tr[data-draft="true"] td { background: var(--mp-warn-bg); }
.admin-code { font-weight: 650; }
.admin-numeric { font-variant-numeric: tabular-nums; }
.admin-price-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  color: var(--mp-muted);
}
.admin-pill {
  display: inline-block;
  font: var(--mp-text-micro) var(--mp-font-family);
  font-weight: 650;
  padding: 2px 7px;
  border-radius: var(--mp-radius-pill);
  background: var(--mp-hover);
  color: var(--mp-muted);
}
.admin-pill--on { background: var(--mp-ok-bg); color: var(--mp-ok); }
.admin-pill--default { background: var(--mp-hover); color: var(--mp-accent); }
.admin-row-actions { display: flex; gap: var(--mp-space-xs); justify-content: flex-end; }

.admin-form {
  margin-top: var(--mp-space-md);
  padding: var(--mp-space-md);
  border: 1px solid var(--mp-accent);
  border-radius: var(--mp-radius-card);
  display: flex;
  flex-direction: column;
  gap: var(--mp-space-sm);
}
.admin-field { display: flex; flex-direction: column; gap: 4px; }
.admin-field label { font: var(--mp-text-caption) var(--mp-font-family); color: var(--mp-muted); }
.admin-field input[type="text"],
.admin-field input[type="number"],
.admin-field select,
.admin-field textarea {
  font: var(--mp-text-body) var(--mp-font-family);
  color: var(--mp-fg);
  background: var(--mp-bg);
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-block);
  padding: 7px var(--mp-space-sm);
}
.admin-field textarea { min-height: 64px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.admin-check { display: flex; align-items: center; gap: var(--mp-space-xs); }
.admin-check label { font: var(--mp-text-secondary) var(--mp-font-family); color: var(--mp-fg); }
.admin-form-actions { display: flex; gap: var(--mp-space-sm); margin-top: var(--mp-space-xs); }
.admin-hint { margin: 0; font: var(--mp-text-micro) var(--mp-font-family); color: var(--mp-muted); }

.admin-empty {
  padding: var(--mp-space-lg) 0;
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
}
.admin-centred { padding: 72px var(--mp-space-md); text-align: center; max-width: 460px; margin: 0 auto; }
.admin-centred h1 { margin: 0 0 var(--mp-space-sm); font: var(--mp-text-display) var(--mp-font-family); }
.admin-centred p {
  margin: 0 0 var(--mp-space-md);
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
}
`.trim();
