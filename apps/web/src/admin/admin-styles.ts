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
 *
 * <h2>What the 2026-08 pass changed</h2>
 *
 * It became a *screen* rather than a document. Before this it was a white page
 * with a rule under a heading and a bare table on it — every element at the same
 * weight, and nothing saying where one section stopped. Now:
 *
 * <ul>
 * <li><strong>The page is on the stage</strong>, and each section is a `Card` from
 * `@mprelist/ui`. That is the same shape `apps/web`'s public pages already have,
 * so the two halves of this one build stopped being two designs.
 * <li><strong>The bar at the top is sticky</strong>, because the table under it is
 * the only thing on this screen that grows without limit, and an operator who has
 * scrolled to the tier they want should still be able to leave.
 * <li><strong>Six things this file used to draw are the design system's now</strong>
 * — the table, the pills, every form control, the hints, the quiet button and the
 * focus ring it never had. What is left here is layout, plus the three column
 * treatments a catalog table needs.
 * </ul>
 */
export const adminCss = `
/* The stage. \`.mp-root\` paints itself --mp-bg, which is a card's colour and not a
   page's; this rule is later in the sheet and the same specificity, which is how
   the public site's own \`.web-stage\` does it too. */
.admin-shell {
  min-height: 100vh;
  background: var(--mp-stage);
}

.admin-topbar {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--mp-bg);
  border-bottom: 1px solid var(--mp-line);
}
.admin-topbar-inner {
  max-width: 1080px;
  margin: 0 auto;
  padding: 11px var(--mp-space-lg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mp-space-sm);
}
.admin-brand {
  display: flex;
  align-items: center;
  gap: var(--mp-space-sm);
  font: var(--mp-text-title) var(--mp-font-family);
  letter-spacing: -0.015em;
}
.admin-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: var(--mp-radius-block);
  background: var(--mp-accent);
  color: var(--mp-on-accent);
}
/* "admin" is what this build *is*, not part of the product's name — so it is a
   word beside the brand rather than in it. */
.admin-brand-tag {
  font: var(--mp-text-caption) var(--mp-font-family);
  font-weight: 600;
  color: var(--mp-muted);
  padding: 2px 7px;
  border-radius: var(--mp-radius-pill);
  background: var(--mp-subtle);
  border: 1px solid var(--mp-line);
}

.admin-page {
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--mp-space-lg) var(--mp-space-lg) 56px;
  color: var(--mp-fg);
}
.admin-sections { display: flex; flex-direction: column; gap: var(--mp-space-lg); }

/* The catalog table. Everything about how a table *looks* is \`.mp-table\`'s; what
   is here is the three columns that need a treatment of their own. */
.admin-table-scroll { overflow-x: auto; }
.admin-table { min-width: 720px; }
.admin-code { font-weight: 650; color: var(--mp-fg); }
.admin-numeric { font-variant-numeric: tabular-nums; }
/* One line per rhythm a tier is sold at (T62, #128) — usually one, sometimes two. */
.admin-price-line { display: flex; align-items: center; gap: var(--mp-space-xs); }
.admin-price-line + .admin-price-line { margin-top: 4px; }
.admin-price-none { color: var(--mp-muted); }
.admin-states { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
/* The row actions are quiet until they are wanted: three secondary buttons per row
   is a wall of chrome down the right of the table, and the row is what an operator
   is reading. They keep their outline on focus and on hover, so nothing is hidden
   from a keyboard. */
.admin-row-actions { display: flex; gap: var(--mp-space-xs); justify-content: flex-end; }
.admin-row-actions .mp-btn { padding: 5px 10px; }
/* A draft is a tier the sync invented from an unrecognised Price: quota 0, unbuyable,
   and something an operator has to finish.
   Marked down its edge rather than by tinting the whole row, which is what it used
   to do — the row's own \`draft\` badge is drawn on \`--mp-warn-bg\`, so a row painted
   the same colour swallowed the one word that says what is wrong with it. */
.admin-table tr[data-draft="true"] td:first-child { box-shadow: inset 2px 0 0 var(--mp-warn); }

/* The forms. Each opens under the row or the section it belongs to, so it is a
   panel inside a card rather than a card of its own. */
.admin-form {
  margin: var(--mp-space-md) 0 0;
  padding: var(--mp-space-md);
  border: 1px solid var(--mp-line);
  border-left: 2px solid var(--mp-accent);
  border-radius: var(--mp-radius-block);
  background: var(--mp-subtle);
  display: flex;
  flex-direction: column;
  gap: var(--mp-space-sm);
}
.admin-form-title {
  margin: 0;
  font: var(--mp-text-secondary) var(--mp-font-family);
  font-weight: 650;
}
/* Two columns where the fields are short and one where they are not, without a
   media query: a form of four short fields on a 1080px page reads as a form, and
   the same four stacked reads as a questionnaire. */
.admin-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: var(--mp-space-sm) var(--mp-space-md);
}
.admin-form-actions { display: flex; gap: var(--mp-space-sm); margin-top: var(--mp-space-xs); }
.admin-form-row { display: flex; gap: var(--mp-space-md); align-items: flex-end; flex-wrap: wrap; }

/* A card whose body is flush still needs a gutter for anything that is not the
   table — the note above it, and the forms that open under it. */
.admin-card-pad { padding: var(--mp-space-md) var(--mp-space-lg) var(--mp-space-lg); }
.admin-card-pad--top { padding: var(--mp-space-md) var(--mp-space-lg) 0; }
.admin-card-pad:empty { display: none; }

.admin-empty {
  padding: var(--mp-space-lg);
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
}
/* The screens with nothing on them but a sentence: signing in, being refused, and
   the two ways this build can fail to become a session. */
.admin-centred {
  max-width: 460px;
  margin: 0 auto;
  padding: 72px var(--mp-space-md);
  text-align: center;
}
.admin-centred h1 {
  margin: 0 0 var(--mp-space-sm);
  font: var(--mp-text-display) var(--mp-font-family);
  letter-spacing: -0.02em;
}
.admin-centred p {
  margin: 0 0 var(--mp-space-md);
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
}
`.trim();
