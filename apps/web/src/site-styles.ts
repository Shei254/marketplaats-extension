import { fontFamily } from "@mprelist/ui";
import geist from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
import montserrat from "@fontsource/montserrat/files/montserrat-latin-600-normal.woff2?url";

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
 *
 * **This site is set in Geist; the popup is not.** The family is the one token this
 * surface redefines rather than takes, on `.web-stage`, so every rule here and in
 * `@mprelist/ui` that reads `var(--mp-font-family)` picks it up and nothing else
 * changes. The popup keeps `system-ui` because it has to paint the instant it
 * opens, and a font there would be a file packed into the extension. The woff2 is
 * bundled by Vite from `@fontsource-variable/geist` and served from this origin:
 * a font from Google's servers would tell Google who reads these pages, which is
 * the thing `no-identity.test.ts` exists to rule out. Latin only — Dutch needs
 * nothing past it, and the `swap` means a slow file costs a reflow, never words.
 *
 * **The brand name is set in Montserrat SemiBold** (2026-09-25, the operator's
 * choice), in the site header and the admin corner only — the wordmark, not the
 * page. One weight, one Latin woff2, served from here for Geist's reason.
 */
export const siteCss = `
@font-face {
  font-family: "Geist Variable";
  font-style: normal;
  font-display: swap;
  font-weight: 100 900;
  src: url("${geist}") format("woff2-variations");
}
@font-face {
  font-family: "Montserrat";
  font-style: normal;
  font-display: swap;
  font-weight: 600;
  src: url("${montserrat}") format("woff2");
}

/* The brand name beside the mark, on the websites (not the popup). */
.web-wordmark {
  font-family: "Montserrat", ${fontFamily};
  font-weight: 600;
}

body {
  margin: 0;
  /* The stage is the page behind the card, and the only surface in this product
     that ever shows it — the popup is its own card, edge to edge. */
  background: var(--mp-stage);
}

/* .mp-root paints itself --mp-bg, which is the card's colour, not the page's.
   Same specificity, later rule: this is the stage. */
.web-stage {
  --mp-font-family: "Geist Variable", ${fontFamily};
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
/* The success page's install link and the cancel page's way back to the plans (T85). */
.web-micro a,
.web-callout a { color: var(--mp-accent); }

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
/* The landing page (T58): the whole width of the window, not the card. Every band
   spans edge to edge and keeps its content to one 1120px measure by padding rather
   than by a wrapper — the gutter is whichever is larger, 24px or half of what is
   left over — so the header, the bands and the footer all line up on one edge. */
.web-stage--wide {
  --web-gutter: max(24px, calc((100% - 1120px) / 2));
  display: block;
  position: relative;
  padding: 0;
  background: var(--mp-bg);
}

/* The header, lying on the hero rather than above it. White because what is under
   it is the mark's gradient in both themes. */
.web-header--over {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1;
  padding: 22px var(--web-gutter);
  border-bottom: 0;
  color: var(--mp-on-brand);
}
.web-header--over .web-mark {
  box-shadow: 0 0 0 1.5px var(--mp-on-brand);
}
.web-header--over .web-nav a,
.web-header--over .web-nav a:hover {
  color: var(--mp-on-brand);
}
.web-header--over .web-nav a:hover { text-decoration: underline; }

.web-page--landing {
  padding: 0;
  text-align: left;
}

/* The mark's gradient is the hero, and the one rule it obeys is the one the mark
   does: nothing is written on the teal end (white on --mp-brand-from is 1.27:1).
   So the teal is put in the corner the demo card covers — top right here, the
   bottom on a phone — and every word stands on the blue half, where white is
   about 8:1. The mark does not flip with the theme, and neither does this. */
.web-hero,
.web-closing {
  color: var(--mp-on-brand);
  background-color: var(--mp-brand-to);
}
.web-hero {
  position: relative;
  box-sizing: border-box;
  min-height: 100svh;
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  align-items: center;
  gap: 56px;
  padding: 112px var(--web-gutter) 96px;
  background-image: linear-gradient(240deg, var(--mp-brand-from) 0%, var(--mp-brand-to) 55%);
}
.web-hero-title {
  margin: 0 0 18px;
  font: var(--mp-text-display) var(--mp-font-family);
  font-size: clamp(42px, 5.2vw, 68px);
  font-weight: 700;
  letter-spacing: -0.045em;
  line-height: 1.02;
}
.web-hero-copy {
  margin: 0 0 32px;
  max-width: 440px;
  font: var(--mp-text-body) var(--mp-font-family);
  font-size: 18px;
  line-height: 1.5;
  opacity: 0.9;
}
.web-hero-micro {
  margin: 14px 0 0;
  font: var(--mp-text-caption) var(--mp-font-family);
  opacity: 0.8;
}

/* An anchor wearing the design system's button, because it leaves the site: a link
   a screen reader announces as one, drawn as the one thing to press. It is the mark
   inverted — white, with the mark's blue as its ink — because a primary button on
   the gradient would be blue on blue. */
.mp-btn.web-install,
.mp-btn.web-install:hover {
  width: auto;
  padding: 14px 24px;
  border-radius: var(--mp-radius-pill);
  font-size: 15px;
  color: var(--mp-brand-to);
  background: var(--mp-on-brand);
  text-decoration: none;
  box-shadow: var(--mp-shadow);
}
.mp-btn.web-install { transition: transform var(--mp-fast) var(--mp-ease); }
.mp-btn.web-install:hover { transform: translateY(-1px); }

/* "Scroll": a chevron drawn from two borders, since the icon set is held to the
   artboards and none of them draws one. */
.web-scroll {
  position: absolute;
  left: 50%;
  bottom: 28px;
  width: 36px;
  height: 36px;
  margin-left: -18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--mp-radius-pill);
  color: var(--mp-on-brand);
  opacity: 0.8;
}
.web-scroll::before {
  content: "";
  width: 10px;
  height: 10px;
  margin-top: -5px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(45deg);
}
.web-scroll:hover { opacity: 1; }

/* Where a reposted ad lands, shown rather than said: four recent ads, the
   visitor's sinking to the bottom and rising back to the top, on a loop.
   Drawn in this product's tokens and nobody else's, so nothing here dresses up as
   Marktplaats.

   **The still frame is the markup.** The rows are in their "after" order and the
   "before" words are hidden, so with the animation off — reduced motion below —
   what is left is the outcome. The animation only ever starts from there: the
   visitor's row is pushed three rows down and the others one row up, then both
   let go. That arithmetic is why a row has a fixed height: 44px and an 8px gap is
   a 52px step, and the keyframes are written in it. */
.web-repost {
  padding: 22px;
  border-radius: 20px;
  background: var(--mp-bg);
  color: var(--mp-fg);
  box-shadow: var(--mp-shadow);
  transform: rotate(-1.5deg);
}
.web-repost-caption {
  margin: 0 0 14px;
  font: var(--mp-text-label) var(--mp-font-family);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mp-muted);
}
/* Two words in one place, one of them showing: the before and after of a caption
   or a timestamp, stacked in a single grid cell so neither moves the line. */
.web-swap { display: inline-grid; }
.web-swap > * { grid-area: 1 / 1; }
.web-before { opacity: 0; }

.web-repost-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.web-repost-row {
  box-sizing: border-box;
  height: 44px;
  display: flex;
  align-items: center;
  gap: var(--mp-space-sm);
  padding: 0 12px;
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-block);
  background: var(--mp-bg);
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
  white-space: nowrap;
  overflow: hidden;
}
.web-repost-row b { color: var(--mp-fg); font-weight: 600; }
.web-repost-row--yours {
  position: relative;
  z-index: 1;
  border-color: var(--mp-accent);
  color: var(--mp-fg);
  box-shadow: 0 0 0 3px var(--mp-ring), var(--mp-shadow-sm);
}
.web-repost-thumb {
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: var(--mp-radius-note);
  background: var(--mp-line);
}
.web-repost-row--yours .web-repost-thumb {
  background-color: var(--mp-brand-to);
  background-image: linear-gradient(135deg, var(--mp-brand-from), var(--mp-brand-to));
}
.web-repost-top {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: var(--mp-radius-pill);
  background: var(--mp-ok-bg);
  font: var(--mp-text-micro) var(--mp-font-family);
  font-weight: 650;
  color: var(--mp-ok);
}

.web-repost .web-before { animation: web-show-before 8s var(--mp-ease) infinite; }
.web-repost .web-after { animation: web-show-after 8s var(--mp-ease) infinite; }
.web-repost-row--yours { animation: web-sink-and-rise 8s var(--mp-ease) infinite; }
.web-repost-row:not(.web-repost-row--yours) { animation: web-make-room 8s var(--mp-ease) infinite; }

@keyframes web-sink-and-rise {
  0%, 30% { transform: translateY(156px); }
  42%, 86% { transform: translateY(0); }
  100% { transform: translateY(156px); }
}
@keyframes web-make-room {
  0%, 30% { transform: translateY(-52px); }
  42%, 86% { transform: translateY(0); }
  100% { transform: translateY(-52px); }
}
@keyframes web-show-before {
  0%, 34% { opacity: 1; }
  38%, 88% { opacity: 0; }
  94%, 100% { opacity: 1; }
}
@keyframes web-show-after {
  0%, 34% { opacity: 0; }
  38%, 88% { opacity: 1; }
  94%, 100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  /* Two classes each, to outweigh the :not() that sets the other rows moving —
     one class loses to it, and those rows would freeze a row too high. */
  .web-repost .web-before,
  .web-repost .web-after,
  .web-repost .web-repost-row { animation: none; }
  .mp-btn.web-install:hover { transform: none; }
}

/* The bands under the hero. */
.web-band {
  padding: 96px var(--web-gutter);
}
.web-band--subtle {
  background: var(--mp-subtle);
  border-top: 1px solid var(--mp-line);
  border-bottom: 1px solid var(--mp-line);
}
.web-band-title {
  margin: 0 0 36px;
  font: var(--mp-text-display) var(--mp-font-family);
  font-size: clamp(30px, 4vw, 44px);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.1;
}
.web-band-copy {
  margin: -20px 0 32px;
  max-width: 560px;
  font: var(--mp-text-body) var(--mp-font-family);
  font-size: 16px;
  color: var(--mp-muted);
  line-height: 1.55;
}

/* Three steps as three tiles. The mark's gradient is a bar along each tile's top
   edge and never under the number, which is the accent: the teal end is not a
   colour words go on, and a number is words. */
.web-steps {
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: step;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.web-steps li {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 28px 26px 30px;
  border: 1px solid var(--mp-line);
  border-radius: 16px;
  background: var(--mp-bg);
  box-shadow: var(--mp-shadow-sm);
  counter-increment: step;
}
.web-steps li::before {
  content: counter(step, decimal-leading-zero);
  margin-bottom: 18px;
  font: var(--mp-text-display) var(--mp-font-family);
  font-size: 44px;
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1;
  color: var(--mp-accent);
  font-variant-numeric: tabular-nums;
}
.web-steps li::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background-image: linear-gradient(90deg, var(--mp-brand-from), var(--mp-brand-to));
}
.web-step-title {
  font: var(--mp-text-title) var(--mp-font-family);
  font-size: 18px;
  letter-spacing: -0.015em;
}
.web-step-copy {
  font: var(--mp-text-body) var(--mp-font-family);
  color: var(--mp-muted);
}

/* The plans (T85): prototype A. Each card leads with its number of reposts in the
   mark's gradient, a meter under it measured against the largest finite grant on
   the page, and its button at the foot. The largest plan is filled with the
   gradient and lifted — it says which plan grants most, which its number already
   does, and not which is popular, which nothing here knows. */
.web-plans {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 20px;
  align-items: stretch;
}
.web-plan {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 26px 22px 22px;
  border: 1px solid var(--mp-line);
  border-radius: 20px;
  background: var(--mp-bg);
  box-shadow: var(--mp-shadow-sm);
}
.web-plan p { margin: 0; }
.web-plan--featured {
  border-color: transparent;
  color: var(--mp-on-brand);
  background: linear-gradient(160deg, var(--mp-brand-from), var(--mp-brand-to));
  box-shadow: var(--mp-shadow);
  transform: translateY(-8px);
}
/* The card somebody pressed before signing in, when they turned out to be paying
   already: shown rather than switched to, since a switch charges a saved card. */
.web-plan--picked { box-shadow: 0 0 0 3px var(--mp-ring), var(--mp-shadow); }
.web-plan-flag {
  position: absolute;
  top: -12px;
  left: 22px;
  padding: 4px 10px;
  border-radius: var(--mp-radius-pill);
  font: var(--mp-text-caption) var(--mp-font-family);
  font-weight: 650;
  color: var(--mp-bg);
  background: var(--mp-fg);
}
.web-plan-name {
  font: var(--mp-text-body) var(--mp-font-family);
  font-weight: 650;
  opacity: 0.8;
}
.web-plan-number {
  margin-top: 14px !important;
  font-family: var(--mp-font-family);
  font-size: 64px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  background: linear-gradient(135deg, var(--mp-brand-from), var(--mp-brand-to));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.web-plan--featured .web-plan-number { background: none; color: inherit; }
.web-plan .web-plan-grant {
  font: var(--mp-text-secondary) var(--mp-font-family);
  opacity: 0.75;
}
.web-plan-meter {
  height: 6px;
  margin: 18px 0;
  overflow: hidden;
  border-radius: var(--mp-radius-pill);
  background: var(--mp-line);
}
.web-plan--featured .web-plan-meter { background: color-mix(in srgb, var(--mp-on-brand) 25%, transparent); }
.web-plan-meter span {
  display: block;
  height: 100%;
  border-radius: var(--mp-radius-pill);
  background: linear-gradient(90deg, var(--mp-brand-from), var(--mp-brand-to));
}
.web-plan--featured .web-plan-meter span { background: var(--mp-on-brand); }
/* Unlimited: full, and fading out rather than ending, since there is no end. */
.web-plan-meter span.is-open { mask-image: linear-gradient(90deg, var(--mp-fg) 70%, transparent); }
.web-plan-price {
  font: var(--mp-text-secondary) var(--mp-font-family);
  font-variant-numeric: tabular-nums;
}
.web-plan-price b { font-size: 26px; letter-spacing: -0.02em; }
.web-plan-note {
  min-height: 1.3em;
  margin: 4px 0 18px !important;
  font: var(--mp-text-caption) var(--mp-font-family);
  opacity: 0.75;
}
.web-plan-btn {
  box-sizing: border-box;
  display: block;
  width: 100%;
  margin-top: auto;
  padding: 12px 16px;
  border: 1px solid transparent;
  border-radius: 12px;
  font: var(--mp-text-body) var(--mp-font-family);
  font-weight: 650;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
}
.web-plan-btn:focus-visible { outline: 2px solid transparent; box-shadow: 0 0 0 3px var(--mp-ring); }
.web-plan-btn:disabled { cursor: default; opacity: 0.6; }
.web-plan-btn--primary {
  color: var(--mp-on-brand);
  background: linear-gradient(135deg, var(--mp-brand-from), var(--mp-brand-to)) border-box;
}
.web-plan-btn--secondary { color: var(--mp-fg); background: var(--mp-bg); border-color: var(--mp-line); }
.web-plan-btn--current { color: var(--mp-ok); background: var(--mp-ok-bg); cursor: default; }
.web-plan-btn--quiet { color: inherit; background: none; text-decoration: underline; opacity: 0.8; }
.web-plan--featured .web-plan-btn--primary { color: var(--mp-brand-to); background: var(--mp-on-brand); }
.web-plan--featured .web-plan-btn--secondary {
  color: var(--mp-on-brand);
  background: color-mix(in srgb, var(--mp-on-brand) 15%, transparent);
  border-color: color-mix(in srgb, var(--mp-on-brand) 40%, transparent);
}

/* Maandelijks / Jaarlijks: this page's only, and shown only when some plan is sold
   yearly. The saving is computed from the plans' own prices. */
.web-rhythm {
  display: inline-flex;
  gap: 4px;
  margin: 0 0 32px;
  padding: 4px;
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-pill);
  background: var(--mp-bg);
}
.web-rhythm button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 18px;
  border: 0;
  border-radius: var(--mp-radius-pill);
  font: var(--mp-text-secondary) var(--mp-font-family);
  font-weight: 650;
  color: var(--mp-muted);
  background: none;
  cursor: pointer;
}
.web-rhythm button.is-on {
  color: var(--mp-on-brand);
  background: linear-gradient(135deg, var(--mp-brand-from), var(--mp-brand-to));
}
.web-rhythm-save {
  padding: 2px 7px;
  border-radius: var(--mp-radius-pill);
  font: var(--mp-text-micro) var(--mp-font-family);
  font-weight: 650;
  color: var(--mp-ok);
  background: var(--mp-ok-bg);
}
.web-rhythm button.is-on .web-rhythm-save {
  color: inherit;
  background: color-mix(in srgb, var(--mp-on-brand) 22%, transparent);
}
.web-plans-notice {
  margin: 0 0 24px;
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-fg);
}

/* Overstappen, confirmed: Stripe's amount before anything is charged. */
.web-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  padding: var(--web-gutter);
  background: color-mix(in srgb, var(--mp-fg) 45%, transparent);
}
.web-dialog {
  box-sizing: border-box;
  width: min(440px, 100%);
  padding: 28px;
  border-radius: 20px;
  background: var(--mp-bg);
  color: var(--mp-fg);
  box-shadow: var(--mp-shadow);
}
.web-dialog-title {
  margin: 0 0 12px;
  font: var(--mp-text-title) var(--mp-font-family);
  font-size: 20px;
}
.web-dialog-copy {
  margin: 0 0 24px;
  font: var(--mp-text-body) var(--mp-font-family);
  color: var(--mp-muted);
  line-height: 1.5;
}
.web-dialog-actions { display: flex; gap: 12px; }
.web-dialog-actions .web-plan-btn { margin-top: 0; }

/* The header's account corner on /, in the header's own colour. */
.web-account {
  padding: 0;
  border: 0;
  font: var(--mp-text-secondary) var(--mp-font-family);
  font-weight: 650;
  color: inherit;
  background: none;
  cursor: pointer;
}
.web-account:hover { text-decoration: underline; }
.web-account-menu { position: relative; }
.web-account-items {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  min-width: 180px;
  padding: 6px;
  border: 1px solid var(--mp-line);
  border-radius: 12px;
  background: var(--mp-bg);
  box-shadow: var(--mp-shadow);
}
.web-account-items button {
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  font: var(--mp-text-secondary) var(--mp-font-family);
  text-align: left;
  color: var(--mp-fg);
  background: none;
  cursor: pointer;
}
.web-account-items button:hover { background: var(--mp-subtle); }
.web-pay-with {
  margin: 20px 0 0;
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
}
.web-plans-unavailable {
  padding: 24px;
  border: 1px dashed var(--mp-line);
  border-radius: 16px;
  background: var(--mp-bg);
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-muted);
  text-align: center;
}
.web-plans-unavailable p { margin: 0 0 10px; }
.web-plans-unavailable b { color: var(--mp-fg); }

/* The second install button, bookending the page in the hero's colours. The words
   are centred and the band is short, so there is no side of it to give the teal
   to: it is a glow in the bottom-left corner, 30% of the way to the far one, which
   stops short of the centre line on a phone as well. */
.web-closing {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  background-image: radial-gradient(circle at 0% 100%, var(--mp-brand-from), transparent 30%);
}
.web-closing .web-band-title { margin-bottom: 28px; }

.web-stage--wide .web-footer {
  padding: 28px var(--web-gutter) 12px;
  border-top: 0;
}
.web-disclaimer {
  margin: 0;
  padding: 0 var(--mp-space-md) var(--mp-space-md);
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-muted);
}
.web-stage--wide .web-disclaimer {
  padding: 0 var(--web-gutter) 28px;
}

/* A tablet and down: one column. The hero's gradient turns to put the teal under
   the demo card, which is now below the words rather than beside them. */
@media (max-width: 860px) {
  .web-hero {
    grid-template-columns: minmax(0, 1fr);
    gap: 48px;
    padding-top: 104px;
    background-image: linear-gradient(0deg, var(--mp-brand-from) 0%, var(--mp-brand-to) 42%);
  }
  .web-scroll { display: none; }
  .web-repost { transform: none; }
  .web-steps { grid-template-columns: minmax(0, 1fr); }
  .web-band { padding-top: 64px; padding-bottom: 64px; }
}
/* A phone: the header's links would crowd the name. */
@media (max-width: 480px) {
  .web-header--over .web-nav { gap: var(--mp-space-md); }
}
`;
