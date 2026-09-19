import { fontFamily, palette, radius, space, text } from "@mprelist/ui";

/**
 * This surface's styling, and the one place in this workspace where the design
 * system is read for its **values** rather than served as its **rules**.
 *
 * `src/login/css.ts` emits a stylesheet, and every colour in it is a
 * `var(--mp-…)` that `themeCss` declares — which is what makes the button on the
 * sign-in page *be* the button `componentCss` draws. **None of that survives the
 * trip into an inbox.** A mail client is not a browser: Gmail keeps no `:root`
 * rule and resolves no custom property, so the sheet that is most faithful to
 * ADR-0021 is the one that arrives as unstyled text. So the rules are rewritten
 * here as inline declarations, and the values — every one of them — are still
 * read from `@mprelist/ui` (ADR-0035).
 *
 * **What that costs is worth being exact about.** A change to `componentCss`'s
 * button reaches the popup, `apps/web` and the sign-in page and does *not* reach
 * here; a change to a *token* reaches all four. Every declaration below is
 * therefore written against the sheet's own rule for the same thing, named in a
 * comment, so the two can be compared by reading rather than by remembering.
 */

/**
 * The light half of the palette, and the only half.
 *
 * A mail carries no theme switch and cannot ask what the reader prefers without
 * a `<style>` block the clients that force dark ignore anyway — Gmail and Outlook
 * invert it themselves, which on a light card with a coloured button is a
 * well-understood result. `BRAND_MARK`'s three values are deliberately identical
 * in both halves, so the ribbon is the same colour either way.
 */
const light = palette.light;

/**
 * A type step, as longhand.
 *
 * `text` holds each step as a `font` shorthand without the family, so the sheet
 * can write `font: var(--mp-text-body) var(--mp-font-family)` and no caller can
 * take a size while forgetting its weight. That shorthand is CSS2 and a browser
 * reads it; **Outlook's engine is Word's**, and its handling of the shorthand is
 * not something to rely on in the one place there is no second chance to render.
 * So it is expanded, from the token rather than beside it.
 *
 * It throws rather than emitting a step it did not understand: a token whose
 * shape changed should stop the build, not quietly send a mail in the client's
 * default face.
 */
function font(step: keyof typeof text): Record<string, string> {
  const shorthand = text[step];
  const [, weight, size, lineHeight] = /^(\d+) ([\d.]+px)\/([\d.]+)$/.exec(shorthand) ?? [];
  if (!weight || !size || !lineHeight) {
    throw new Error(
      `@mprelist/ui's \`text.${step}\` is \`${shorthand}\`, which is not `
        + "`<weight> <size>/<line-height>` — the shape apps/keycloak-theme/src/email "
        + "expands into longhand for Outlook. Update `font()` beside the token.",
    );
  }
  return {
    "font-family": fontFamily,
    "font-size": size,
    "font-weight": weight,
    "line-height": lineHeight,
  };
}

/** Declarations as a `style` attribute reads them, in the order given. */
function style(...parts: Array<Record<string, string>>): string {
  return Object.entries(Object.assign({}, ...parts) as Record<string, string>)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}

/**
 * Every style the shell and the copy draw with, by the name each is known by.
 *
 * The shell reads these as **theme properties** — the same crossing `brandName`
 * makes, and for the same reason: `html/template.ftl` is committed source, and a
 * committed file with `#1d63ef` in it is the copy `brand.json` exists to not
 * have. FreeMarker escapes them on the way out, so a `"` inside the font stack
 * arrives as `&quot;` and is decoded by the client's own parser before any CSS
 * is read.
 */
export const STYLES = {
  /** `.login-stage`, which paints the page behind the card. */
  mailBodyStyle: style({ margin: "0", padding: "0", "background-color": light.stage }),
  /** The same colour again on the table, because some clients drop `<body>`'s. */
  mailPageStyle: style({
    margin: "0",
    padding: "0",
    width: "100%",
    "background-color": light.stage,
  }),
  /** `.login-stage`'s own padding, on the cell that centres the card. */
  mailGutterStyle: style({ padding: `${space.xl} ${space.md}` }),
  /**
   * `.mp-card` plus `.login-shell`'s width.
   *
   * **`max-width` and no MSO conditional.** Outlook's engine ignores it and draws
   * the card across the reading pane, which is wide rather than broken; the fix
   * is a conditional-comment table only Outlook sees, and a second copy of the
   * layout is not worth one client's proportions (ADR-0035 prefers the option
   * that adds nothing). 480px rather than the 400 of `.login-shell`: that number
   * is the width of a sign-in form, and this is prose.
   */
  mailCardStyle: style({
    width: "100%",
    "max-width": "480px",
    "background-color": light.bg,
    border: `1px solid ${light.line}`,
    "border-radius": radius.card,
  }),
  /**
   * `.login-ribbon` — the mark's own axis across the top of the card.
   *
   * `background-color` under the gradient is not a fallback for old browsers; it
   * is what Outlook draws, and it is the same `brand-to` the sign-in page ends
   * its ramp on. `font-size: 0` and a matching `line-height` because a table cell
   * with nothing in it collapses in several clients.
   */
  mailRibbonStyle: style({
    height: "3px",
    "line-height": "3px",
    "font-size": "0",
    "background-color": light["brand-to"],
    "background-image": `linear-gradient(135deg, ${light["brand-from"]}, ${light["brand-to"]})`,
  }),
  /** `.login-head`. */
  mailHeadStyle: style({
    padding: `${space.xl} ${space.lg} ${space.lg}`,
    "border-bottom": `1px solid ${light.line}`,
    "text-align": "center",
  }),
  /** `.login-brand` — the wordmark, which on this surface is the whole mark. */
  mailBrandStyle: style(font("display"), {
    color: light.fg,
    "letter-spacing": "-0.02em",
  }),
  /** `.login-tagline`. */
  mailTaglineStyle: style(font("caption"), {
    margin: `${space.xs} 0 0`,
    color: light.muted,
  }),
  /** `.login-body`, which is where the nested mail lands. */
  mailContentStyle: style(font("body"), {
    padding: space.lg,
    color: light.fg,
  }),
  /** `.login-foot`, under the card rather than in it. */
  mailFootStyle: style(font("micro"), {
    margin: `${space.md} 0 0`,
    padding: `0 ${space.md}`,
    "text-align": "center",
    color: light.muted,
  }),
  /** `.login-foot a`, which is muted rather than accent on that page too. */
  mailFootLinkStyle: style({ color: light.muted, "text-decoration": "underline" }),
} as const;

/**
 * A paragraph of the mail's own body.
 *
 * These live inside a **message**, not inside the shell, so they are subject to
 * `kcSanitize` — `KeycloakSanitizerPolicy` calls `allowStyling`, so the attribute
 * survives, but the declarations in it are filtered against OWASP's own property
 * list. Everything here is the ordinary half of that list; the button below is
 * where the interesting case is.
 */
export const paragraphStyle = style(font("body"), {
  margin: `0 0 ${space.md}`,
  color: light.fg,
});

/** The quieter last line — "you did not ask for this, do nothing". */
export const asideStyle = style(font("secondary"), {
  margin: `${space.lg} 0 0`,
  color: light.muted,
});

/** The signature under it, which is the brand said once more in plain type. */
export const signatureStyle = style(font("secondary"), {
  margin: `${space.md} 0 0`,
  color: light.muted,
});

/**
 * The link as text, for a client that renders the button and will not open it.
 *
 * `word-break` because a Keycloak action token is about 900 characters and a
 * card is 480 wide, and a line that does not break takes the layout with it.
 */
export const urlStyle = style(font("micro"), {
  color: light.muted,
  "word-break": "break-all",
});

/**
 * The call to action: `.mp-btn` + `.mp-btn--block` + `.mp-btn--primary`, inlined.
 *
 * **`display: inline-block` where the sheet has `inline-flex`**, because a flex
 * container is not something to rely on in Outlook and there is nothing inside
 * this one to lay out. **And the block modifier's `width: 100%` is deliberately
 * not carried over**: it is there because a sign-in form is 400px wide and its
 * submit is the only thing on that row, where a full-width bar in a 480px card
 * of prose reads as a banner rather than as a button.
 *
 * **It is built to degrade.** If OWASP's property list turns out not to carry
 * `border-radius` or `display`, what is left is a padded, coloured, bold link —
 * which is still the thing to press. Nothing here is load-bearing on a property
 * surviving.
 */
export const buttonStyle = style(font("control-large"), {
  display: "inline-block",
  "box-sizing": "border-box",
  padding: `10px ${space.md}`,
  border: "1px solid transparent",
  "border-radius": radius.block,
  color: light["on-accent"],
  "background-color": light.accent,
  "background-image": `linear-gradient(135deg, ${light.accent}, ${light["accent-hover"]})`,
  "text-align": "center",
  "text-decoration": "none",
});

/** The row a button sits on, centred the way `.login-title` is. */
export const buttonRowStyle = style({
  margin: `0 0 ${space.md}`,
  "text-align": "center",
});
