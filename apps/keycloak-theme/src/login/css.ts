/**
 * This surface's own rules — the stage, the card, and the handful of shapes
 * Keycloak's markup has that no other consumer of `@mprelist/ui` does.
 *
 * Same shape as `apps/web`'s `site-styles.ts` and the popup's `popup-styles.ts`,
 * and for the same reason: everything a *control* needs comes from the design
 * system, and what is left here is layout. The difference is where the control
 * classes are applied. The popup and the site write `className="mp-btn"` in JSX;
 * this page's markup belongs to Keycloak, so `theme.properties` hands the same
 * class names to Keycloak's own `kc…Class` hooks and the button on this page *is*
 * the design system's button rather than one drawn to look like it.
 *
 * Every colour is a `var(--mp-…)`, and `css.test.ts` asserts both that and
 * that nothing here re-describes a control the sheet already draws.
 */
export const loginCss = `
/* The page behind the card. \`.mp-root\` paints itself \`--mp-bg\`, which is the
   card's colour and not the page's; this sheet is emitted after the component
   sheet, so the later rule at equal weight is the stage. */
.login-stage {
  margin: 0;
  min-height: 100vh;
  min-height: 100dvh;
  padding: var(--mp-space-xl) var(--mp-space-md);
  background: var(--mp-stage);
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

/* One column, the width of a sign-in form and no wider. A card that grows with
   the viewport turns two fields into a banner. */
.login-shell {
  width: 100%;
  max-width: 400px;
  margin: auto;
}

/* \`.mp-card\` brings the surface, the edge, the radius and the resting elevation.
   What is added here is the lift — this card is the only thing on its page, and
   the sheet's two elevations are "resting" and "lifted" — and \`overflow: hidden\`,
   which is what the ribbon below is clipped to. */
.login-card {
  overflow: hidden;
  box-shadow: var(--mp-shadow);
}

/* The mark's own axis, three pixels of it, across the top of the card.

   The one place the brand's gradient appears as a *fill* on this page. It carries
   no text and never will: white on \`--mp-brand-from\` is 1.27:1, which is the
   contrast that keeps the teal end of this ramp away from anything anybody has to
   read (see \`BRAND_MARK\` in the token sheet). */
.login-ribbon {
  height: 3px;
  background-color: var(--mp-brand-to);
  background-image: linear-gradient(135deg, var(--mp-brand-from), var(--mp-brand-to));
}

.login-head {
  padding: var(--mp-space-xl) var(--mp-space-lg) var(--mp-space-lg);
  border-bottom: 1px solid var(--mp-line);
  text-align: center;
}

/* The artwork itself, resized from the one master \`brand.json\` names, rather than
   the stroked \`Icon name="logo"\` the other four surfaces draw in an accent tile.

   Two reasons, and the second is the one that decides it. There is no React here
   to render the component, and inlining its geometry into a template would be the
   copy \`packages/ui\` exists to prevent. And the mark's own colours are the same
   in both themes by decision — \`BRAND_MARK\` says so — so the one thing a raster
   cannot do, follow a theme, is the one thing this mark must not do. */
.login-mark {
  display: block;
  width: 48px;
  height: 48px;
  margin: 0 auto var(--mp-space-sm);
  border-radius: var(--mp-radius-card);
  box-shadow: var(--mp-shadow-sm);
}

.login-brand {
  display: block;
  font: var(--mp-text-display) var(--mp-font-family);
  letter-spacing: -0.02em;
}

/* What the product is, for somebody who arrived here in a window Chrome opened
   and is being asked for a password by a name they have seen once. */
.login-tagline {
  margin: var(--mp-space-xs) auto 0;
  max-width: 34ch;
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
}

.login-body { padding: var(--mp-space-lg); }

/* The page's own heading — which step of the flow this is. Quieter than the brand
   above it on purpose: the name is what identifies the page, and "Inloggen bij uw
   account" is what it is currently asking. */
.login-title {
  margin: 0 0 var(--mp-space-lg);
  font: var(--mp-text-title) var(--mp-font-family);
  text-align: center;
}

/* Which account the step in front of you belongs to, on the pages that continue
   one somebody already started — and the link back out of it. */
.login-attempted {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: var(--mp-space-sm);
  margin-bottom: var(--mp-space-md);
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
}
.login-attempted label { font-weight: 600; color: var(--mp-fg); }

/* "* verplichte velden", over a form that has some. */
.login-required-note {
  margin: 0 0 var(--mp-space-md);
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-muted);
  text-align: right;
}

/* Keycloak's own message, in the design system's note. The tone is chosen in the
   template from \`message.type\`, so the modifier is the sheet's rather than a
   second palette here. */
.login-alert {
  margin: 0 0 var(--mp-space-md);
  text-align: left;
}

/* Every field wrapper Keycloak emits is \`.mp-field\`; this is the gap between two
   of them. A rule on the form itself would not do — \`login.ftl\`'s form carries an
   id and no class, and three of these templates have no form element at all. */
.login-form { display: block; }
.login-group + .login-group { margin-top: var(--mp-space-md); }

/* The two halves of a field as the user-profile form writes it: the label beside
   its required marker, and the control with whatever the template puts under it.
   Both are children of \`.mp-field\`, which is already a column with a gap, so what
   is added here is the row the first one is and the column the second one is. */
.login-label-wrap {
  display: flex;
  align-items: baseline;
  gap: 3px;
}
.login-input-wrap {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
/* Keycloak's own marker, and one of two class names on these pages that is not
   ours to choose — the templates write it literally. */
.login-card .required { color: var(--mp-err); }
.login-content { display: block; }

/* The password field and the button that reveals it. \`login.ftl\` wraps the two in
   one element, which is the only thing making an overlay safe here. */
.login-input-group { position: relative; }
.login-input-group .mp-input { padding-right: 38px; }

.login-reveal {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: var(--mp-radius-note);
  color: var(--mp-muted);
  background: none;
  cursor: pointer;
  transition:
    color var(--mp-fast) var(--mp-ease),
    background-color var(--mp-fast) var(--mp-ease);
}
.login-reveal:hover { color: var(--mp-fg); background: var(--mp-hover); }
.login-reveal:focus-visible {
  outline: 2px solid transparent;
  outline-offset: 2px;
  box-shadow: 0 0 0 3px var(--mp-ring);
}

/* The eye and the struck-through eye, drawn on the icon set's 20x20 grid at its
   stroke width, as masks rather than as images: \`passwordVisibility.js\` swaps the
   whole \`className\` of this element, so the glyph has to be a class and the
   element it lands on cannot be an \`<svg>\` — assigning \`className\` on one does
   nothing. The mask reads alpha, never colour, which is why \`currentColor\` here
   resolves to nothing in particular and the paint comes from the button. */
.login-reveal-icon {
  width: 18px;
  height: 18px;
  background: currentColor;
  mask-repeat: no-repeat;
  mask-position: center;
  mask-size: contain;
}
.login-reveal-icon--show {
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='currentColor' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M1.8 10S4.9 4.8 10 4.8 18.2 10 18.2 10 15.1 15.2 10 15.2 1.8 10 1.8 10Z'/%3E%3Ccircle cx='10' cy='10' r='2.6'/%3E%3C/svg%3E");
}
.login-reveal-icon--hide {
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='currentColor' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M1.8 10S4.9 4.8 10 4.8c1.2 0 2.3.3 3.2.7M16.4 7.4c1.2 1.4 1.8 2.6 1.8 2.6S15.1 15.2 10 15.2c-1.4 0-2.6-.4-3.6-.9'/%3E%3Cpath d='M8.2 8.2a2.6 2.6 0 0 0 3.6 3.6'/%3E%3Cpath d='M3.4 3.4l13.2 13.2'/%3E%3C/svg%3E");
}

/* The row under the password: "remember me" on the left where the realm offers
   it, "forgot password?" on the right. Both halves are optional and the row holds
   its shape with either one missing.

   \`flex-direction\` is stated because this element is also \`.mp-field\`, which is a
   column — the template puts both classes on one div, and inheriting the column
   would stack the two links. */
.login-settings {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: var(--mp-space-md);
  margin-top: var(--mp-space-md);
  font: var(--mp-text-caption) var(--mp-font-family);
}

/* The same block on a page with one link in it rather than two — "back to
   sign-in" under the register and reset forms, which centres. */
.login-options {
  display: flex;
  justify-content: center;
  font: var(--mp-text-caption) var(--mp-font-family);
}
.login-settings .login-options { justify-content: flex-end; }
.login-options-links { display: flex; gap: var(--mp-space-md); }

/* The submit, set apart from the last field. Two selectors because the templates
   disagree about which hook the block carries: \`login.ftl\` gives it the plain
   form-group class and the others give it the buttons one. The id is Keycloak's
   and is the same on every one of them. */
.login-buttons,
#kc-form-buttons { margin-top: var(--mp-space-lg); }
/* Two buttons in a flow that offers a way back — "cancel" beside "submit". */
.login-buttons-wrap { display: flex; gap: var(--mp-space-sm); }
.login-buttons-wrap .mp-btn { flex: 1; }

/* A checkbox's or radio's label, which sits beside the control rather than over
   it — \`.mp-check-row\` is the row and this is the text in it. */
.login-check-label {
  font: var(--mp-text-secondary) var(--mp-font-family);
  color: var(--mp-fg);
  cursor: pointer;
}
.login-check-label--disabled { color: var(--mp-disabled); cursor: default; }

/* Keycloak says which field it rejected in an attribute, so the control can show
   it. Scoped to this page rather than added to the sheet: \`Input\` has no invalid
   state to pass through, so a rule on \`.mp-input\` itself would be a state the
   design system names and no React caller can reach. */
.login-body .mp-input[aria-invalid="true"] { border-color: var(--mp-err); }

/* The field's own error, under the control it belongs to. \`.mp-hint\` is the muted
   sentence under a field and this is the loud one; it is the only rule here that
   states a foreground colour, because the sheet has no error text style that is
   not a filled note. */
.login-error {
  display: block;
  margin-top: 5px;
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-err);
}

/* "Nieuwe gebruiker? Registreren", and the equivalent foot of the other pages. */
.login-aside {
  margin-top: var(--mp-space-lg);
  padding-top: var(--mp-space-md);
  border-top: 1px solid var(--mp-line);
  text-align: center;
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
}

/* An identity provider, if the realm is ever given one. The buttons themselves
   are the sheet's secondary block button; what is here is the divider that says
   where the password form ends and the rule that keeps a provider's own logo from
   deciding the row's height. */
.login-social {
  margin-top: var(--mp-space-lg);
  padding-top: var(--mp-space-md);
  border-top: 1px solid var(--mp-line);
}
.login-social h2 {
  margin: 0 0 var(--mp-space-sm);
  font: var(--mp-text-label) var(--mp-font-family);
  color: var(--mp-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.login-social hr { display: none; }
.login-social-list {
  display: flex;
  flex-direction: column;
  gap: var(--mp-space-sm);
  margin: 0;
  padding: 0;
  list-style: none;
}
.login-social-list--grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.login-social-item { min-width: 0; }
.login-social-name { overflow: hidden; text-overflow: ellipsis; }
.login-social-logo { width: 18px; height: 18px; flex: none; }
.login-social-disabled { opacity: 0.55; pointer-events: none; }

/* Links, once, for a page whose markup gives them no class of its own. */
.login-card a,
.login-foot a {
  color: var(--mp-accent);
  text-decoration: none;
  border-radius: var(--mp-radius-note);
}
.login-card a:hover,
.login-foot a:hover { text-decoration: underline; }
.login-card a:focus-visible,
.login-foot a:focus-visible {
  outline: 2px solid transparent;
  outline-offset: 2px;
  box-shadow: 0 0 0 3px var(--mp-ring);
}

/* Under the card, not in it: the same three links the site puts in its footer, so
   somebody can read what they are agreeing to before they make an account. */
.login-foot {
  margin: var(--mp-space-md) 0 0;
  text-align: center;
  font: var(--mp-text-micro) var(--mp-font-family);
  color: var(--mp-muted);
}
.login-foot a { color: var(--mp-muted); }
.login-foot a:hover { color: var(--mp-fg); }

/* The locale switcher. The realm offers one language, so this is drawn for the
   day it offers two rather than being left to render as a bare list. */
.login-locale {
  display: flex;
  justify-content: flex-end;
  padding: var(--mp-space-sm) var(--mp-space-lg) 0;
  font: var(--mp-text-caption) var(--mp-font-family);
}
.login-locale ul {
  margin: var(--mp-space-xs) 0 0;
  padding: var(--mp-space-xs);
  list-style: none;
  position: absolute;
  background: var(--mp-bg);
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-block);
  box-shadow: var(--mp-shadow);
}
.login-locale ul[aria-hidden="true"] { display: none; }
.login-locale button {
  font: var(--mp-text-caption) var(--mp-font-family);
  color: var(--mp-muted);
  background: none;
  border: 0;
  cursor: pointer;
}

@media (forced-colors: active) {
  /* The ribbon is decoration and a forced palette drops \`background-image\`, which
     would leave a solid bar of the one stop that survives. It goes instead. */
  .login-ribbon { display: none; }
}
`.trim();
