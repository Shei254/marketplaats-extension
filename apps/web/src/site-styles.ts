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
.web-mark { display: inline-flex; color: var(--mp-accent); }

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
.web-callout-mark { display: inline-flex; color: var(--mp-accent); }

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
.web-footer a { color: var(--mp-accent); text-decoration: none; }
.web-footer a:hover { color: var(--mp-accent-hover); text-decoration: underline; }
`;
