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

/* The dashed box that says this text is not a lawyer's. Dashed on purpose: it is
   the one thing on the page that is about the page rather than about the product,
   and it should not read as another section of it. */
.web-placeholder {
  margin: 30px 0 0;
  padding: 12px 14px;
  border: 1px dashed var(--mp-line);
  border-radius: var(--mp-radius-card);
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
  line-height: 1.6;
}
.web-placeholder b { color: var(--mp-fg); }
`;
