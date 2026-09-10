/**
 * The admin corner's own rules (T54, #85).
 *
 * A third string beside the public site's, injected the same way — there is still
 * no CSS pipeline in this build. Every colour is a `var(--mp-…)`: the tokens are
 * the design canvas's, and a literal here would be this file quietly deciding one.
 * `admin-styles.test.ts` holds both halves of that.
 *
 * **There is no artboard for any of this.** The canvas draws the popup and the
 * public pages; `/admin` is a tool for one person and is drawn out of the same
 * tokens rather than out of a design nobody made. What that buys is that it looks
 * like the rest of the product without pretending to be designed.
 *
 * <h2>What the 2026-08 pass changed</h2>
 *
 * The first pass made it a *screen* rather than a document — the stage, cards, a
 * sticky bar, and every control taken from the design system. This one makes it an
 * *application*, because a screen has room for exactly one subject and this corner
 * already had two stacked on top of each other:
 *
 * <ul>
 * <li><strong>A sidebar, sticky the full height.</strong> It says where you are,
 * what else there is, who you are signed in as and how to leave — and it says all
 * of that at two pages as readably as at ten, which a bar with a brand on it does
 * not. Under 900px it becomes a strip of nav across the top, with no toggle to
 * leave in the wrong position.
 * <li><strong>Nothing on the page that is not somebody's work.</strong> The Stripe
 * prices nobody tagged used to sit open under the catalog — a list nobody acts on
 * beneath the list an operator works in — and then were a page of their own, which
 * is a whole door for a list that is empty on a well-kept account. They are a fold
 * on the catalog now: silent when there is nothing, one line when there is.
 * <li><strong>A page heading, and four numbers under it.</strong> What the catalog
 * looks like at a glance — how many plans, how many buyable, how many half
 * finished — before anybody reads a row.
 * <li><strong>One form, in one place</strong>, directly under the heading, with the
 * row it belongs to marked. Three panels that opened at the bottom of a table were
 * three places to go looking for the thing you just clicked.
 * </ul>
 */
export const adminCss = `
/* The stage. \`.mp-root\` paints itself --mp-bg, which is a card's colour and not a
   page's; these rules are later in the sheet and the same specificity, which is how
   the public site's own \`.web-stage\` does it too. */
.admin-app {
  display: flex;
  align-items: flex-start;
  min-height: 100vh;
  background: var(--mp-stage);
}
.admin-plain {
  min-height: 100vh;
  background: var(--mp-stage);
}
.admin-plain-bar {
  background: var(--mp-bg);
  border-bottom: 1px solid var(--mp-line);
  padding: 11px var(--mp-space-lg);
}

/* The sidebar: brand, where you are, who you are. Sticky at the full height of the
   viewport, because the catalog is the one thing here that grows without limit and
   an operator who has scrolled to the tier they want should still be able to see
   both of those and still be able to leave. */
.admin-sidebar {
  position: sticky;
  top: 0;
  width: 248px;
  flex: none;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--mp-bg);
  border-right: 1px solid var(--mp-line);
}
.admin-sidebar-head {
  padding: var(--mp-space-md) var(--mp-space-lg);
  border-bottom: 1px solid var(--mp-line);
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

.admin-nav {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--mp-space-md) var(--mp-space-sm);
}
.admin-nav-group { display: flex; flex-direction: column; gap: 2px; }
.admin-nav-group + .admin-nav-group { margin-top: var(--mp-space-md); }
/* One group today. The heading is here because a flat list of five words is the
   moment a navigation stops saying which of them are about the same thing. */
.admin-nav-heading {
  margin: 0 0 var(--mp-space-xs);
  padding: 0 10px;
  font: var(--mp-text-label) var(--mp-font-family);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--mp-muted);
}
.admin-nav-item {
  display: flex;
  align-items: center;
  gap: var(--mp-space-sm);
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--mp-radius-block);
  background: none;
  color: var(--mp-muted);
  font: var(--mp-text-secondary) var(--mp-font-family);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--mp-fast) var(--mp-ease),
    color var(--mp-fast) var(--mp-ease);
}
.admin-nav-item:hover { background: var(--mp-hover); color: var(--mp-fg); }
/* The design system rings its own controls; this is the one control this surface
   draws for itself, so it takes the same ring rather than none. */
.admin-nav-item:focus-visible {
  outline: 2px solid transparent;
  outline-offset: 2px;
  box-shadow: 0 0 0 3px var(--mp-ring);
}
/* Read off the attribute a screen reader reads, rather than a class kept in step
   with it by hand. */
.admin-nav-item[aria-current="page"] {
  background: var(--mp-hover);
  color: var(--mp-accent);
  font-weight: 650;
}
.admin-nav-glyph { display: inline-flex; flex: none; }
.admin-nav-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-sidebar-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mp-space-sm);
  padding: var(--mp-space-md) var(--mp-space-lg);
  border-top: 1px solid var(--mp-line);
}
.admin-who { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.admin-who-label { font: var(--mp-text-micro) var(--mp-font-family); color: var(--mp-muted); }
.admin-who-role { display: flex; }

/* The column one page is drawn in. */
.admin-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.admin-page {
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: var(--mp-space-xl) var(--mp-space-lg) 56px;
  color: var(--mp-fg);
}
.admin-page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mp-space-md);
  flex-wrap: wrap;
  margin-bottom: var(--mp-space-lg);
}
.admin-page-headings { min-width: 0; }
.admin-page-head h1 {
  margin: 0;
  font: var(--mp-text-display) var(--mp-font-family);
  letter-spacing: -0.02em;
}
.admin-page-lede {
  margin: 5px 0 0;
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
  max-width: 72ch;
}
.admin-page-actions { display: flex; gap: var(--mp-space-sm); flex: none; }
.admin-sections { display: flex; flex-direction: column; gap: var(--mp-space-lg); }
/* A note carries its own margin, for the row it usually sits under. Between the
   sections of a page the gap is the layout's, and both is a crooked stack. */
.admin-sections > .mp-note { margin: 0; }

/* What the catalog looks like before anybody reads a row. Four tiles rather than a
   sentence, because three of them are counts and the fourth is a currency code. */
.admin-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: var(--mp-space-md);
}
.admin-stat {
  padding: var(--mp-space-md) var(--mp-space-lg);
  background: var(--mp-bg);
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-card);
  box-shadow: var(--mp-shadow-sm);
}
.admin-stat-label {
  margin: 0;
  font: var(--mp-text-label) var(--mp-font-family);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--mp-muted);
}
.admin-stat-value {
  margin: 6px 0 0;
  font: var(--mp-text-display) var(--mp-font-family);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.admin-stat-note { margin: 3px 0 0; font: var(--mp-text-micro) var(--mp-font-family); color: var(--mp-muted); }
/* The one tile that is a job rather than a fact: a draft is a tier the Stripe sync
   invented and nobody finished. */
.admin-stat--attention { border-color: var(--mp-warn); background: var(--mp-warn-bg); }
.admin-stat--attention .admin-stat-value { color: var(--mp-warn); }

/* The Stripe Prices carrying no tier, folded back onto the catalog (ADR-0019) as
   one line that opens. A warning rather than a card, because it is the only thing
   on this page that is a job and is not a row — and closed by default, because on
   a well-kept account there is nothing in it at all. */
.admin-untagged {
  padding: var(--mp-space-md) var(--mp-space-lg);
  border: 1px solid var(--mp-warn);
  border-radius: var(--mp-radius-card);
  background: var(--mp-warn-bg);
  font: var(--mp-text-secondary) var(--mp-font-family);
}
.admin-untagged-line {
  cursor: pointer;
  color: var(--mp-warn);
  max-width: 80ch;
}
/* The list is Stripe's own words — ids, nicknames, amounts — and reads as text on
   the page rather than as more of the warning above it. */
.admin-untagged > .admin-table-scroll { margin-top: var(--mp-space-md); color: var(--mp-fg); }
.admin-untagged-how {
  margin: var(--mp-space-md) 0 0;
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-warn);
}
.admin-untagged-how code { font-family: var(--mp-font-mono); color: var(--mp-fg); }

/* The catalog table. Everything about how a table *looks* is \`.mp-table\`'s; what
   is here is the columns that need a treatment of their own. */
.admin-table-scroll { overflow-x: auto; }
.admin-table { min-width: 800px; }
.admin-code { font-weight: 650; color: var(--mp-fg); }
.admin-numeric { font-variant-numeric: tabular-nums; }
/* One line per rhythm a tier is sold at (T62) — usually one, sometimes two. A
   ticket number is spelled without its hash inside this string: the rule below that
   forbids literal colours cannot tell one from a three-digit hex. */
.admin-price-line { display: flex; align-items: center; gap: var(--mp-space-xs); }
.admin-price-line + .admin-price-line { margin-top: 4px; }
.admin-price-none { color: var(--mp-muted); }
.admin-states { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.admin-row-actions { display: flex; gap: var(--mp-space-xs); justify-content: flex-end; }
.admin-row-actions .mp-btn { padding: 5px 10px; }
/* A draft, marked down its edge rather than by tinting the whole row: the row's own
   \`draft\` badge is drawn on --mp-warn-bg, so a row painted the same colour
   swallowed the one word that says what is wrong with it. */
.admin-table tr[data-draft="true"] td:first-child { box-shadow: inset 2px 0 0 var(--mp-warn); }
/* The row the open form belongs to. The form is at the top of the page and the row
   can be a screen away, so each has to point at the other. */
.admin-table tr[data-open="true"] td { background: var(--mp-hover); }
.admin-table tr[data-open="true"] td:first-child { box-shadow: inset 2px 0 0 var(--mp-accent); }

/* The Catalog order (T75, ADR-0030): a handle to drag a row by and two buttons to
   step it with. Narrow enough that the column costs the table one thumb's width —
   \`width: 1%\` on a table cell is the idiom for "as narrow as its content". */
.admin-order { width: 1%; white-space: nowrap; }
.admin-order-controls { display: flex; align-items: center; gap: 2px; }
/* Drawn out of a token rather than shipped as an icon: \`packages/ui\` matches every
   glyph it ships against an artboard, and \`/admin\` is the one surface the canvas
   does not draw (T54). A dot grid is what a grip is, and this is one rule of it. */
.admin-grip {
  flex: none;
  width: 13px;
  height: 20px;
  background-image: radial-gradient(var(--mp-line) 1.4px, transparent 1.4px);
  background-size: 5px 6px;
  background-position: 2px 3px;
  background-repeat: repeat;
  cursor: grab;
}
.admin-table tr:hover .admin-grip {
  background-image: radial-gradient(var(--mp-muted) 1.4px, transparent 1.4px);
}
.admin-grip:active { cursor: grabbing; }
/* Tighter than the popup header's refresh, which is what \`.mp-icon-btn\` is sized
   for: two of these sit inside a table row. */
.admin-move { padding: 1px 4px; font: var(--mp-text-control) var(--mp-font-family); }
/* The row in the air, and the row it would land on. Later in the sheet than the
   draft and open edges above, so a drag says where it is going even on a row that
   is already saying something else — for as long as the drag lasts. */
.admin-table tr[data-carrying="true"] td { opacity: 0.45; }
.admin-table tr[data-under="true"] td { box-shadow: inset 0 2px 0 var(--mp-accent); }

/* The forms. One at a time, directly under the heading, in a panel that says what
   it is and carries the way out of it in the same corner every time. */
.admin-form {
  display: flex;
  flex-direction: column;
  gap: var(--mp-space-md);
  padding: var(--mp-space-lg);
  border: 1px solid var(--mp-line);
  border-left: 3px solid var(--mp-accent);
  border-radius: var(--mp-radius-card);
  background: var(--mp-bg);
  box-shadow: var(--mp-shadow-sm);
}
.admin-form-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mp-space-md);
}
.admin-form-title {
  margin: 0;
  font: var(--mp-text-title) var(--mp-font-family);
  letter-spacing: -0.01em;
}
.admin-form-lede {
  margin: 3px 0 0;
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
  max-width: 68ch;
}
/* Two columns where the fields are short and one where they are not, without a
   media query: a form of four short fields on a wide page reads as a form, and the
   same four stacked reads as a questionnaire. */
.admin-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: var(--mp-space-md);
  /* Three columns at most, whatever the window is. A number of cents in a field
     500px wide is a field that has stopped saying what it wants. */
  max-width: 780px;
}
.admin-form-actions { display: flex; gap: var(--mp-space-sm); flex-wrap: wrap; }

/* The flags (T69). A number, the hatch under it, and - when it is open - the JSON
   the number cannot say. Grouped rather than laid into \`.admin-form-grid\`, because
   the hatch belongs to the field above it and not to the form: two columns would
   put a disclosure beside a price. */
.admin-features {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--mp-space-sm);
  max-width: 780px;
}
/* As narrow as the number it holds. A cap of 10 in a field the width of the panel
   is a field that has stopped saying what it wants — the same reason the grid caps
   itself. */
.admin-features-cap { max-width: 260px; }
/* The two children that are not the number are full width: a textarea somebody
   edits JSON in, and the sentence saying why it will not close. */
.admin-features > .mp-field:not(.admin-features-cap),
.admin-features > .mp-note {
  align-self: stretch;
}
/* Flush with the label above it, so the disclosure reads as part of the field
   rather than as another of the form's buttons. */
.admin-features-hatch { padding-left: 0; padding-right: 0; }

/* The rules a form cannot enforce and an operator has to know: Stripe's
   immutability, what a quota does to somebody mid-period. A list rather than a
   stack of paragraphs, because they are read the way small print is — scanned for
   the one that applies. */
.admin-notes {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-muted);
}
.admin-notes code {
  font-family: var(--mp-font-mono);
  font-size: 0.94em;
  color: var(--mp-fg);
}

/* Nothing to show, said in a sentence — an empty card reads as a failure. */
.admin-empty {
  margin: 0;
  padding: var(--mp-space-xl) var(--mp-space-lg);
  text-align: center;
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
}
/* The screens with nothing on them but a sentence: signing in, being refused, and
   the two ways this build can fail to become a session. */
.admin-centred {
  max-width: 460px;
  margin: 0 auto;
  padding: 52px var(--mp-space-md);
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

/* Narrow: the sidebar stops being a column and becomes a strip across the top. No
   toggle, no state, and no button that can be left in the wrong position. */
@media (max-width: 900px) {
  .admin-app { display: block; }
  .admin-sidebar {
    position: static;
    width: auto;
    height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--mp-line);
  }
  .admin-nav {
    display: flex;
    overflow-x: auto;
    padding: var(--mp-space-sm) var(--mp-space-md);
  }
  .admin-nav-group { flex-direction: row; gap: var(--mp-space-xs); }
  .admin-nav-group + .admin-nav-group { margin: 0 0 0 var(--mp-space-sm); }
  .admin-nav-heading { display: none; }
  .admin-nav-item { width: auto; flex: none; }
  .admin-page { padding: var(--mp-space-lg) var(--mp-space-md) 40px; }
}
`.trim();
