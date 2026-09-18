import { componentCss, themeCss } from "@mprelist/ui";

import type { ThemeType } from "../theme";
import { loginCss } from "./css";

/**
 * Keycloak's class hooks, pointed at the design system.
 *
 * The templates this type inherits write `class="${properties.kcInputClass!}"`
 * wherever they emit a control, so this map is the whole mechanism by which the
 * sign-in form becomes *our* sign-in form. The values are `packages/ui`'s real
 * class names, which means the button on this page is the one `componentCss`
 * draws rather than one this workspace drew to look like it — a change to the
 * sheet arrives here the same way it arrives in the popup.
 *
 * `login-…` values are the shapes Keycloak's markup has that no other consumer of
 * that package does — a password field with a reveal button inside it, a row of
 * form options, an error under one field — and they live in `css.ts`.
 *
 * **`kcButtonLargeClass` is deliberately empty.** It is applied alongside
 * `kcButtonBlockClass` on every submit in these templates, and the sheet's block
 * button is already drawn at the larger of the two control sizes
 * (`--mp-text-control-large`). A class that repeated that would be a second
 * spelling of a decision the sheet has made.
 */
export const HOOKS: Record<string, string> = {
  // Structure.
  kcFormClass: "login-form",
  kcFormGroupClass: "mp-field login-group",
  kcLabelWrapperClass: "login-label-wrap",
  kcInputWrapperClass: "login-input-wrap",
  kcContentWrapperClass: "login-content",

  // The field: a label, a control, the error under it, and the sentences the
  // user-profile form can put either side of it.
  kcLabelClass: "mp-label",
  kcInputClass: "mp-input",
  kcInputGroup: "login-input-group",
  kcInputErrorMessageClass: "login-error",
  kcInputHelperTextBeforeClass: "mp-hint",
  kcInputHelperTextAfterClass: "mp-hint",

  // Checkboxes and radios. The sheet draws the native control and tells it what
  // colour it is; a hand-drawn one would be a second keyboard implementation.
  kcCheckboxInputClass: "mp-check",
  kcInputClassCheckbox: "mp-check-row",
  kcInputClassCheckboxInput: "mp-check",
  kcInputClassCheckboxLabel: "login-check-label",
  kcInputClassRadio: "mp-check-row",
  kcInputClassRadioInput: "mp-check",
  kcInputClassRadioLabel: "login-check-label",
  kcInputClassRadioCheckboxLabelDisabled: "login-check-label--disabled",

  // The row under the password, and the one the buttons sit in.
  kcFormOptionsClass: "login-options",
  kcFormOptionsWrapperClass: "login-options-links",
  kcFormSettingClass: "login-settings",
  kcFormButtonsClass: "login-buttons",
  kcFormButtonsWrapperClass: "login-buttons-wrap",

  // Buttons. `kcButtonClass` is on every one of them and the tone is added beside
  // it, which is exactly how `Button` composes them.
  kcButtonClass: "mp-btn mp-btn--rect",
  kcButtonPrimaryClass: "mp-btn--primary",
  kcButtonDefaultClass: "mp-btn--secondary",
  kcButtonBlockClass: "mp-btn--block",
  kcButtonLargeClass: "",

  // The reveal button inside the password field. `passwordVisibility.js` assigns
  // `className` outright when it toggles, so each of the two icon values has to
  // be the element's whole class list rather than a modifier.
  kcFormPasswordVisibilityButtonClass: "login-reveal",
  kcFormPasswordVisibilityIconShow: "login-reveal-icon login-reveal-icon--show",
  kcFormPasswordVisibilityIconHide: "login-reveal-icon login-reveal-icon--hide",

  // Identity providers. The realm has none and ADR-0005 keeps them a possibility
  // rather than a plan; these are here so that turning one on is a realm setting
  // and not also a stylesheet.
  kcFormSocialAccountSectionClass: "login-social",
  kcFormSocialAccountListClass: "login-social-list",
  kcFormSocialAccountListGridClass: "login-social-list--grid",
  kcFormSocialAccountListButtonClass: "mp-btn mp-btn--rect mp-btn--secondary mp-btn--block",
  kcFormSocialAccountListButtonDisabledClass: "login-social-disabled",
  kcFormSocialAccountGridItem: "login-social-item",
  kcFormSocialAccountNameClass: "login-social-name",
  kcCommonLogoIdP: "login-social-logo",
};

/**
 * The sizes this type draws the mark at, resized at build time from the one
 * master `brand.json` names — the same arrangement the extension's toolbar icons
 * and the site's favicon are on, and for the same reason: no derivative of the
 * artwork is drawn twice, so redrawing it stays a one-file edit.
 *
 * **Three, and the list is what the templates ask for.** 48 is the mark on the
 * card, 96 is that at 2x, and 32 is the tab. `templates.test.ts` holds this map
 * to the `<img>` and `<link>` tags that read it, so a size added here without a
 * consumer, or asked for by a template and not emitted, fails rather than 404s.
 */
export const ICONS: Record<string, number> = {
  "img/logo-48.png": 48,
  "img/logo-96.png": 96,
  "img/favicon-32.png": 32,
};

/**
 * The one stylesheet this type serves.
 *
 * Three sheets concatenated rather than three `<link>`s, because the order
 * matters twice — the components read properties the tokens declare, and
 * `.login-stage` repaints a background `.mp-root` sets — and one file cannot have
 * its order changed by a template that lists them in the wrong sequence.
 */
export function loginStylesheet(): string {
  return `${themeCss}\n\n${componentCss}\n\n${loginCss}\n`;
}

/**
 * The sign-in flow: Keycloak's own templates, in our clothes.
 *
 * `parent=base` is the load-bearing half. Keycloak's `base` theme carries the
 * flow — the sign-in form, registration, the reset chain, the error and info
 * pages — and styles none of it, so there is nothing here to undo. That is why
 * this is not `keycloak.v2`, whose PatternFly would have to be fought.
 */
export const login: ThemeType = {
  properties: (brand) => ({
    parent: "base",
    // The stylesheet below, and the only one.
    styles: "css/login.css",
    ...brand,
    ...HOOKS,
  }),
  resources: { "css/login.css": loginStylesheet() },
  icons: ICONS,
};
