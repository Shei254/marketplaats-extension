/**
 * The popup's own rules — the header, the quota block, the rows and the two
 * centred screens.
 *
 * Everything a *control* needs comes from `@mprelist/ui`; what is here is layout
 * for this one surface, which no other consumer of that package has. Same shape
 * as the package's own stylesheet — a string, injected once — so there is still
 * no CSS pipeline in a bundle that has to run in a Chrome popup and, later, in a
 * shadow root on somebody else's page.
 *
 * Every colour is a `var(--mp-…)`: the tokens are the design canvas's, and a
 * literal here would be this file quietly deciding one for itself.
 *
 * <h2>What the 2026-08 pass changed, and what it did not</h2>
 *
 * Nothing moved on the screen. The header is still brand-left, actions-right; the
 * quota is still under it; the rows are still title, price, button. What changed
 * is that the surface now has a **rhythm** — one vertical gutter, one row height,
 * one gap between a thing and the thing it is about — and that four things this
 * file used to draw itself now come from the design system: the quiet header
 * buttons (`Button tone="ghost"`), the plan-card pill (`Badge`), the search input
 * (`Input`) and the quota bar, which did not exist at all (`Meter`).
 *
 * **The quota is a bar now, and that is the one addition worth arguing for.** It
 * was three words — "2 of 3 relists left" — for the number this product is about,
 * and a fraction is read before it is counted. The words stay beside it, because a
 * bar cannot say when the quota comes back and that is the actionable half.
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
  padding: 11px var(--mp-space-md);
  border-bottom: 1px solid var(--mp-line);
}
.popup-brand {
  display: flex;
  align-items: center;
  gap: var(--mp-space-sm);
  min-width: 0;
  font: var(--mp-text-title) var(--mp-font-family);
  letter-spacing: -0.015em;
}
/* The mark sits in a tile rather than loose beside the word, which is the same
   shape the signed-out screen draws it at and the reason it reads as a logo. */
.popup-mark {
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
.popup-actions { display: flex; align-items: center; gap: 2px; }
/* The header's own scale. \`ghost\` is a control the whole product shares, and in
   a 360px header it is a caption beside a glyph rather than a 13.5px control. */
.popup-header .mp-btn--ghost {
  padding: 5px 8px;
  border-radius: var(--mp-radius-note);
  font: var(--mp-text-caption) var(--mp-font-family);
  font-weight: 600;
}

/* The quota block: what you are on, what is left of it as a bar and as a
   sentence, and when it comes back. */
.popup-plan {
  display: grid;
  gap: 5px;
  padding: 9px var(--mp-space-md) 11px;
  border-bottom: 1px solid var(--mp-line);
}
.popup-plan-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mp-space-sm);
}
.popup-plan-name {
  display: flex;
  align-items: center;
  gap: var(--mp-space-xs);
  min-width: 0;
  font: var(--mp-text-secondary) var(--mp-font-family);
  font-weight: 650;
}
.popup-plan-left {
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.popup-plan-foot {
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-muted);
}
/* A spent quota is not an error and is no longer painted as one: the count turns
   and the bar is empty, which is the fact, and the prompt underneath carries the
   colour. A failing card *is* an error — Stripe is retrying and relisting has
   stopped — so that one keeps its tint. */
.popup-plan--spent .popup-plan-left { color: var(--mp-warn); font-weight: 600; }
.popup-plan--failing { background: var(--mp-err-bg); }
.popup-plan--failing .popup-plan-left { color: var(--mp-err); font-weight: 600; }

/* The gated prompts: what happened, and what it means for the plan. */
.popup-prompt {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px var(--mp-space-md);
  border-bottom: 1px solid var(--mp-line);
}
/* The glyph in a tinted disc, so the prompt reads as one object rather than as a
   loose icon that happens to be next to some text. */
.popup-prompt-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: var(--mp-radius-pill);
  background: var(--mp-hover);
  color: var(--mp-accent);
}
.popup-prompt-mark--failing { background: var(--mp-err-bg); color: var(--mp-err); }
.popup-prompt-title {
  margin: 0 0 2px;
  font: var(--mp-text-secondary) var(--mp-font-family);
  font-weight: 650;
}
.popup-prompt-copy {
  margin: 0;
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
  line-height: 1.45;
}

/* The screens with nothing but a message on them. */
.popup-centred { padding: 36px 26px 30px; text-align: center; }
.popup-badge {
  width: 48px;
  height: 48px;
  margin: 0 auto var(--mp-space-md);
  border-radius: var(--mp-radius-card);
  background: var(--mp-accent);
  color: var(--mp-on-accent);
  box-shadow: var(--mp-shadow);
  display: flex;
  align-items: center;
  justify-content: center;
}
.popup-warning {
  width: 44px;
  height: 44px;
  margin: 0 auto var(--mp-space-md);
  border-radius: var(--mp-radius-pill);
  background: var(--mp-warn-bg);
  color: var(--mp-warn);
  display: flex;
  align-items: center;
  justify-content: center;
}
.popup-title {
  margin: 0 0 var(--mp-space-sm);
  font: 650 16.5px/1.3 var(--mp-font-family);
  letter-spacing: -0.02em;
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
 * apart — the rows are the part T30b (#79) added a button and a note to.
 */
export const adListCss = `
/* The search box over the list (T31, #40). It sits in the list's own sheet
   because it is the list's control and shares its gutter — and its bottom line is
   the one the first row would have drawn, so the two never double up. */
.popup-search {
  display: flex;
  align-items: center;
  gap: var(--mp-space-xs);
  padding: 10px var(--mp-space-md);
  border-bottom: 1px solid var(--mp-line);
}
.popup-search .mp-input { padding: 6px 10px; font: var(--mp-text-secondary) var(--mp-font-family); }
.popup-search-clear { flex: none; }

.popup-ads { list-style: none; margin: 0; padding: 0; max-height: 420px; overflow-y: auto; }
.popup-ad {
  padding: 11px var(--mp-space-md);
  border-bottom: 1px solid var(--mp-line);
  transition: background-color var(--mp-fast) var(--mp-ease);
}
.popup-ad:last-child { border-bottom: 0; }
.popup-ad:hover { background: var(--mp-subtle); }
.popup-ad-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
/* Two rows, and the explicit \`minmax(0, 1fr)\` is what lets both of them shrink:
   a grid column is \`auto\` by default, which is wide enough for the whole title
   and would take the ellipsis off it. */
.popup-ad-info {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 3px;
}
.popup-ad-title {
  display: block;
  font: var(--mp-text-body) var(--mp-font-family);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The price line — a chip for the kind of price, the number, then the aside.
   \`flex\` and not the three block spans it started as: they stacked, which in a
   360px popup turned a two-line row into a four-line one. Only the aside may be
   clipped, so the chip and the number are never the parts that go. */
.popup-ad-meta {
  display: flex;
  align-items: center;
  gap: var(--mp-space-xs);
  min-width: 0;
}
.popup-ad-type { flex: none; }
/* The number carries the ink now, where it used to be \`muted\` like everything
   else on this line. That was right while it was alone under the title and is not
   right beside a chip: two greys of the same weight read as one smudge, and the
   number is the half somebody is actually looking for. */
.popup-ad-price {
  flex: none;
  font: var(--mp-text-caption) var(--mp-font-family);
  font-weight: 500;
  color: var(--mp-fg);
  font-variant-numeric: tabular-nums;
}
.popup-ad-bidding {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-muted);
}
.popup-ads-empty {
  padding: 30px var(--mp-space-md);
  text-align: center;
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
}
.popup-ads-failed { padding: 10px var(--mp-space-md) var(--mp-space-md); }

/* The row that is running. One at a time (T30b, #79), so this is never two. */
.popup-ad[data-state="busy"] { background: var(--mp-hover); }

/* Selecting several to repost at once (T68, #147; ADR-0025).

   The box is first in the row and \`flex: none\`, so the title keeps the shrinking
   it already does and the ellipsis stays where it was — the row was already at its
   width budget with a title and a button in it, and this is the third thing in a
   360px window.

   A disabled box is drawn at the opacity every other locked control here uses
   rather than hidden. That is the whole conversion argument: a free user should be
   able to see the thing they do not have, next to their own ads. */
.popup-ad-tick,
.popup-select-all-tick {
  flex: none;
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--mp-accent);
  cursor: pointer;
}
.popup-ad-tick:disabled,
.popup-select-all-tick:disabled { cursor: not-allowed; opacity: 0.45; }
/* A 15px box is a 15px target, which is half of what a pointer wants and a
   quarter of what a trackpad gives it. The box keeps its drawn size — it has to
   sit level with a title and a chip — and gains the rest as padding it can be
   missed into. */
.popup-ad-tick,
.popup-select-all-tick { padding: 6px; margin: -6px; box-sizing: content-box; }

/* A ticked row is tinted, and that is not decoration: the checkbox is 15px of
   glyph at the far left of a 360px row, and a selection of six read off six of
   those alone is a count nobody trusts. The whole row moving is what makes "these
   ones" legible at a glance — and it is the only feedback a click on a box
   produces at all until the bar under the list appears. */
.popup-ad[data-ticked="true"] {
  /* The same fill the pointer paints on hover, which on its own is why the rule
     beside it is not optional: a ticked row and a hovered row would otherwise be
     the identical grey, and a selection of six read off six 15px glyphs is a count
     nobody trusts. An inset rule rather than a border, so the row does not move
     2px sideways the moment it is ticked. */
  background: var(--mp-hover);
  box-shadow: inset 2px 0 0 var(--mp-accent);
}

/* The header over the list: tick everything the plan allows, and read back how
   much of the cap is spent.

   It shares the search box's gutter and rhythm because it is the same kind of
   thing — a control *about* the list rather than a row in it — and sits between
   the two so the reading order is: find them, select them, repost them. */
.popup-select-all {
  display: grid;
  gap: 3px;
  padding: 7px var(--mp-space-md);
  border-bottom: 1px solid var(--mp-line);
  background: var(--mp-subtle);
}
.popup-select-all-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mp-space-xs);
}
/* Only drawn when a search has taken part of the selection off the screen, which
   is the one state where the count and the ticked boxes disagree. */
.popup-select-all-note {
  margin: 0;
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-muted);
}
.popup-select-all-label {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  cursor: pointer;
}
.popup-select-all-label:has(.popup-select-all-tick:disabled) { cursor: not-allowed; }
.popup-select-all-text {
  font: var(--mp-text-caption) var(--mp-font-family);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.popup-select-all-hint {
  flex: none;
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-muted);
  font-variant-numeric: tabular-nums;
}
/* The header's Clear is a caption beside a control, not a control in its own
   right — the same scale the header bar gives its ghost buttons. */
.popup-select-all .mp-btn--ghost {
  flex: none;
  padding: 3px 7px;
  border-radius: var(--mp-radius-note);
  font: var(--mp-text-micro) var(--mp-font-family);
  font-weight: 600;
}

/* The bar under the list: what a selection costs, what a run is doing, what a
   stopped one left behind. One strip in three states, because to the user it is
   one place. */
/* **Pinned, because otherwise it is not there.** Chrome caps a popup at 600px and
   this surface spends all of it — header, quota, search box and a 420px list —
   before the bar is laid out at all, so a bar in ordinary flow lands below the
   fold. And the fold cannot be scrolled past in the obvious way: the pointer is
   over the ad list, which is its own scroller and eats the wheel. The primary
   action of the whole feature was reachable only by a user who thought to move the
   mouse off the list first, which in practice means it was not reachable.

   Sticky rather than fixed so it still participates in layout: on the short screens
   — three ads, an empty list — it sits where it always did, at the end of the
   content, with nothing to stick to.

   One class for both feet, because there is only ever one of them on the screen and
   they are the same object: whichever of "start this batch" and "this is a paid
   feature" the plan makes true. Its own opaque ground and a line above it, and no
   shadow — an elevation here would have to be a literal colour, and this sheet
   holds layout only (ADR-0021). */
.popup-foot {
  position: sticky;
  bottom: 0;
  z-index: 2;
  padding: 10px var(--mp-space-md);
  border-top: 1px solid var(--mp-line);
  background: var(--mp-bg);
}
.popup-batch {
  display: grid;
  gap: 6px;
}
.popup-batch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mp-space-xs);
}
.popup-batch-row .mp-btn { flex: 1 1 auto; }
.popup-batch-row .mp-btn--ghost { flex: none; }
.popup-batch-progress {
  font: var(--mp-text-secondary) var(--mp-font-family);
  font-weight: 500;
}
.popup-batch-note {
  margin: 0;
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-muted);
}
/* The line a free user gets instead of the bar, beside boxes they cannot tick —
   pinned by \`popup-foot\` for the reason the bar is, which matters more here than
   there. This sentence is the entire conversion surface ADR-0007 asks for: below
   the fold it leaves a free user looking at a column of dead checkboxes with no
   explanation on the screen, which reads as a broken extension rather than as a
   plan they could buy. */
.popup-batch-locked {
  margin: 0;
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-muted);
}
.popup-link {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--mp-accent);
  text-decoration: underline;
  cursor: pointer;
}
`.trim();

/**
 * The plan cards (T52, #83). A third string for `adListCss`'s reason: this is a
 * screen of its own and nothing else on this surface uses a line of it.
 *
 * Sizes and gaps are the canvas's (`docs/design/PlanCards.dc.html`) expressed in
 * the tokens rather than in its literals, which is the rule the two above keep —
 * the artboard draws a 10px card radius and the sheet names 12px for cards, so the
 * token wins and the difference is a pixel nobody can see.
 *
 * **One button per rhythm is T62's (#128) decision and it stands**: two amounts
 * side by side is the comparison somebody is making, and a toggle above the cards
 * would hide the plan that is only sold one way. What changed is which of them is
 * loud — the first rhythm is the primary button and the rest are secondary, so a
 * card is one decision with an alternative rather than two equal slabs of blue.
 */
export const planCardCss = `
.popup-plans-body { padding: var(--mp-space-md); }
.popup-plans-title {
  margin: 0 0 3px;
  font: var(--mp-text-title) var(--mp-font-family);
  letter-spacing: -0.015em;
}
.popup-plans-lede {
  margin: 0 0 var(--mp-space-md);
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
}

/* The ways to pay (T65, #137), inside the lede rather than under it: it is the
   same thought as "Checkout opens in a new tab" — what is about to happen — and a
   second paragraph would read as a second point. Full-strength text against the
   muted lede, because it is the half somebody is scanning for. */
.popup-plans-ways { color: var(--mp-fg); }

.popup-plans { display: flex; flex-direction: column; gap: 10px; }
.popup-plan-card {
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-card);
  padding: 13px var(--mp-space-md) var(--mp-space-md);
  background: var(--mp-bg);
  box-shadow: var(--mp-shadow-sm);
}
/* The plan they are already on, marked by its border as well as by its badge. */
.popup-plan-card--current { border-color: var(--mp-accent); }
.popup-plan-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mp-space-sm);
}
.popup-plan-card-name {
  font: var(--mp-text-body) var(--mp-font-family);
  font-weight: 650;
}
.popup-plan-card-grant {
  margin: 3px 0 0;
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
}
/* The buttons under a card, and the gap that keeps two rhythms from reading as
   one control split in half. */
.popup-plan-card .mp-btn { margin-top: 10px; }

.popup-plans-empty {
  padding: 24px 0;
  text-align: center;
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
}
.popup-plans-failed {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--mp-space-sm);
  padding: var(--mp-space-sm) 0;
}
.popup-plans-fine {
  margin: var(--mp-space-md) 0 0;
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-muted);
  line-height: 1.5;
}
/* The way to Stripe's own pages, which is not a plan and so is not a card. The
   negative margin is optical: a ghost button's own padding would otherwise indent
   its text past the copy above it. */
.popup-plans-manage { margin: var(--mp-space-xs) 0 0 -12px; }

/* The prompts grew a button with T52; before it they were two lines. */
.popup-prompt .mp-btn { margin-top: var(--mp-space-sm); }
`.trim();
