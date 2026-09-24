/**
 * This site's own rules — the stage, the card, its header and its footer, and the
 * one centred block every public page is (T50, #81).
 *
 * Same shape as the popup's `popup-styles.ts` and for the same reason: everything
 * a *control* needs comes from `@mprelist/ui`, and what is here is layout no other
 * consumer of that package has. A string rather than a `.css` file, so the two
 * surfaces are built the same way — Vite would happily bundle a stylesheet, but a
 * second mechanism for the same job is a second one to keep in step.
 *
 * Every colour is a `var(--mp-…)`. `site-styles.test.ts` asserts that, and that no
 * rule reaches for a property the theme does not declare — the failure that
 * renders transparent instead of loudly.
 *
 * **Where the artboards and the token sheet disagree, the sheet wins.** `Success`
 * and `Cancel` draw a 14px card radius and a 10px callout; the sheet names card
 * radii as 10–12px and this uses that token for both. What the artboards have that
 * the sheet did not is the 24px heading, and that became a token rather than a
 * literal here (`--mp-text-display`).
 */
export const siteCss = `
body {
  margin: 0;
  /* The stage is the page behind the card, and the only surface in this product
     that ever shows it — the popup is its own card, edge to edge. */
  background: var(--mp-stage);
}

/* .mp-root paints itself --mp-bg, which is the card's colour, not the page's.
   Same specificity, later rule: this is the stage. */
.web-stage {
  min-height: 100vh;
  padding: 28px var(--mp-space-md);
  background: var(--mp-stage);
  display: flex;
  justify-content: center;
}

.web-card {
  width: 100%;
  max-width: 824px;
  align-self: flex-start;
  background: var(--mp-bg);
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-card);
  box-shadow: var(--mp-shadow);
  overflow: hidden;
}

.web-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mp-space-md);
  padding: var(--mp-space-md) 30px;
  border-bottom: 1px solid var(--mp-line);
}
.web-brand {
  display: flex;
  align-items: center;
  gap: var(--mp-space-sm);
  font: var(--mp-text-title) var(--mp-font-family);
  letter-spacing: -0.01em;
}
/* The same tile the popup's header and the admin corner's draw it in, so one
   product does not have two logos. */
.web-mark {
  width: 24px;
  height: 24px;
  border-radius: var(--mp-radius-block);
}

/* Privacy and Terms, on every page (T36, #45). The one being read is marked with
   aria-current rather than with a class, so the emphasis and the thing a screen
   reader announces are one fact rather than two that can disagree. */
.web-nav {
  display: flex;
  gap: var(--mp-space-lg);
}
.web-nav a {
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
  text-decoration: none;
}
.web-nav a:hover { color: var(--mp-fg); }
.web-nav a[aria-current="page"] { color: var(--mp-fg); font-weight: 650; }

/* The page itself: one centred column, whatever the page is. */
.web-page {
  padding: 56px 30px 52px;
  text-align: center;
}
.web-badge {
  width: 52px;
  height: 52px;
  margin: 0 auto 18px;
  border-radius: var(--mp-radius-pill);
  display: flex;
  align-items: center;
  justify-content: center;
}
.web-badge--ok { background: var(--mp-ok-bg); color: var(--mp-ok); }
.web-badge--quiet { background: var(--mp-hover); color: var(--mp-muted); }

.web-title {
  margin: 0 0 10px;
  font: var(--mp-text-display) var(--mp-font-family);
  letter-spacing: -0.02em;
}
.web-copy {
  margin: 0 auto 26px;
  max-width: 430px;
  font: var(--mp-text-body) var(--mp-font-family);
  color: var(--mp-muted);
  line-height: 1.6;
}
.web-micro {
  margin: 26px 0 0;
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
}

/* The one instruction that matters on every one of these pages: the product is
   the extension, and it is in the toolbar rather than on this page. */
.web-callout {
  /* A <p>, so that the sentence is a sentence — and margin: 0, because the UA
     gives one 1em top and bottom and the block above it already sets the gap. */
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 11px 16px;
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-card);
  background: var(--mp-hover);
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
}
.web-callout b { color: var(--mp-fg); font-weight: 600; }
/* Tiled like every other mark rather than a loose accent glyph: this is the one
   place on these pages the product names itself, and a mark that is the logo on
   four surfaces and a coloured glyph on the fifth is the drift \`.mp-mark\` exists
   to stop. Same 24px box as the header's, so the two read as one mark on a page
   that shows both. */
.web-callout-mark {
  width: 24px;
  height: 24px;
  border-radius: var(--mp-radius-block);
}

.web-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--mp-space-md);
  padding: var(--mp-space-md) 30px;
  border-top: 1px solid var(--mp-line);
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
}
.web-footer-links { display: inline-flex; flex-wrap: wrap; gap: var(--mp-space-xs); }
.web-footer a { color: var(--mp-accent); text-decoration: none; }
.web-footer a:hover { color: var(--mp-accent-hover); text-decoration: underline; }

/* A document rather than a message: read left to right, in a column narrow enough
   to read at all, inside the frame's own padding. The canvas draws the two legal
   pages 16px tighter at the top than the pages that carry one sentence; the
   difference is not a token and not worth a second block of padding. */
.web-doc {
  max-width: 640px;
  margin: 0 auto;
  text-align: left;
}
.web-doc-title {
  margin: 0 0 5px;
  font: var(--mp-text-display) var(--mp-font-family);
  letter-spacing: -0.02em;
}
.web-doc-updated {
  margin: 0;
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
}
.web-doc-rule {
  height: 1px;
  margin: 22px 0 0;
  background: var(--mp-line);
}
.web-doc-heading {
  margin: 26px 0 7px;
  font: var(--mp-text-title) var(--mp-font-family);
  letter-spacing: -0.01em;
}
.web-doc-body {
  margin: 0;
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
  line-height: 1.65;
}
/* A section is several paragraphs now that the terms are a document rather than a
   description, and two paragraphs at margin: 0 are one wall of text. The gap is
   between them and never above the first, which the heading has already spaced. */
.web-doc-body + .web-doc-body,
.web-doc-body + .web-doc-list,
.web-doc-list + .web-doc-body {
  margin-top: var(--mp-space-sm);
}

/* The one enumeration either document has: the grounds an account can be closed
   on. Indented to the marker rather than hung off the page edge, so the items line
   up with the paragraph that introduces them. */
.web-doc-list {
  margin: 0;
  padding-left: 20px;
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
  line-height: 1.65;
}
.web-doc-list li + li { margin-top: 4px; }
/* The landing page (T58), docs/design/Landing.dc.html: a hero, then sections that
   run edge to edge across the card, so the frame's padding moves onto each of them
   rather than around the lot. */
.web-page--landing {
  padding: 0;
  text-align: left;
}
.web-hero {
  padding: 52px 30px 40px;
  text-align: center;
}
.web-hero-title {
  margin: 0 0 12px;
  font: var(--mp-text-display) var(--mp-font-family);
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.2;
}
.web-hero-copy { max-width: 520px; }
/* An anchor wearing the design system's primary button, because it leaves the
   site: a link a screen reader announces as one, drawn as the one thing to press. */
.web-install {
  width: auto;
  display: inline-flex;
  padding: 11px 20px;
  text-decoration: none;
}
.web-install:hover { color: var(--mp-on-accent); text-decoration: none; }
.web-hero-micro { margin-top: 12px; }

.web-compare {
  display: flex;
  gap: 18px;
  max-width: 600px;
  margin: 38px auto 0;
  padding: 18px;
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-card);
  background: var(--mp-subtle);
}
.web-compare-column {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.web-compare-title {
  margin: 0 0 4px;
  font: var(--mp-text-caption) var(--mp-font-family);
  font-weight: 600;
  color: var(--mp-muted);
  text-align: left;
}
.web-compare-arrow {
  align-self: center;
  padding-top: 18px;
  color: var(--mp-muted);
}
.web-compare-row {
  display: flex;
  align-items: center;
  gap: var(--mp-space-sm);
  padding: 8px 10px;
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-block);
  background: var(--mp-bg);
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
  white-space: nowrap;
  overflow: hidden;
}
.web-compare-row b { color: var(--mp-fg); }
.web-compare-row--yours {
  border-color: var(--mp-accent);
  color: var(--mp-fg);
  box-shadow: 0 0 0 3px var(--mp-ring);
}
.web-compare-thumb {
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: var(--mp-radius-skeleton);
  background: var(--mp-line);
}
.web-compare-top {
  margin-left: auto;
  font: var(--mp-text-micro) var(--mp-font-family);
  font-weight: 650;
  color: var(--mp-accent);
}

.web-section {
  padding: 34px 30px;
  border-top: 1px solid var(--mp-line);
}
.web-section--subtle { background: var(--mp-subtle); }
.web-section-title {
  margin: 0 0 14px;
  font: var(--mp-text-title) var(--mp-font-family);
  font-size: 17px;
  letter-spacing: -0.01em;
}
.web-section-copy {
  margin: 0 0 16px;
  max-width: 600px;
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
  line-height: 1.6;
}

/* Three numbered steps side by side, the number a tile rather than a list marker
   so it reads as a step and not as a footnote. */
.web-steps {
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: step;
  display: flex;
  gap: 22px;
}
.web-steps li {
  flex: 1;
  display: flex;
  gap: 11px;
  font: var(--mp-text-secondary) var(--mp-font-family);
  line-height: 1.55;
  counter-increment: step;
}
.web-steps li::before {
  content: counter(step);
  width: 26px;
  height: 26px;
  flex: none;
  margin-top: -3px;
  border-radius: var(--mp-radius-pill);
  background: var(--mp-hover);
  color: var(--mp-accent);
  font-weight: 650;
  display: flex;
  align-items: center;
  justify-content: center;
}

.web-points {
  margin: 0;
  padding: 0;
  max-width: 640px;
  list-style: none;
}
.web-points li {
  position: relative;
  margin: 0 0 9px;
  padding-left: 18px;
  font: var(--mp-text-secondary) var(--mp-font-family);
  line-height: 1.6;
}
.web-points li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 9px;
  width: 6px;
  height: 6px;
  border-radius: var(--mp-radius-pill);
  background: var(--mp-accent);
}

.web-plans {
  display: flex;
  gap: var(--mp-space-md);
}
.web-plan {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 15px;
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-card);
  background: var(--mp-bg);
  box-shadow: var(--mp-shadow-sm);
}
.web-plan p { margin: 0; }
.web-plan-name { font: var(--mp-text-title) var(--mp-font-family); }
.web-plan .web-plan-grant {
  margin-bottom: 6px;
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
}
.web-plan-price {
  font: var(--mp-text-secondary) var(--mp-font-family);
  font-variant-numeric: tabular-nums;
}
.web-pay-with {
  margin: 14px 0 0;
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
}
.web-plans-unavailable {
  padding: 18px;
  border: 1px dashed var(--mp-line);
  border-radius: var(--mp-radius-card);
  background: var(--mp-subtle);
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
  text-align: center;
}
.web-plans-unavailable p { margin: 0 0 10px; }
.web-plans-unavailable b { color: var(--mp-fg); }

.web-disclaimer {
  margin: 0;
  padding: 0 30px var(--mp-space-md);
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-muted);
}

/* A phone: the three side-by-side rows become columns, and the comparison stacks. */
@media (max-width: 640px) {
  .web-hero, .web-section { padding-left: var(--mp-space-md); padding-right: var(--mp-space-md); }
  .web-steps, .web-plans, .web-compare { flex-direction: column; }
  .web-compare-arrow { align-self: center; padding: 0; transform: rotate(90deg); }
}
`;
