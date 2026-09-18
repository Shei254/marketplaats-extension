import { componentCss, themeCss } from "@mprelist/ui";
import { describe, expect, it } from "vitest";

import brand from "../../../../brand.json";
import { themeTypes } from "../theme";
import { loginCss } from "./css";
import { HOOKS, loginStylesheet } from "./index";

/**
 * Every `properties.kc…` the templates this theme *inherits* read, taken out of
 * `org.keycloak.keycloak-themes-26.7.1.jar` on 2026-09-19 with
 *
 *   for f in login register register-commons user-profile-commons \
 *            login-reset-password login-update-password password-commons \
 *            info error login-page-expired login-verify-email login-update-profile \
 *            login-oauth-grant logout-confirm terms; do
 *     grep -o 'properties\.kc[A-Za-z-]*' base/login/$f.ftl
 *   done | sort -u
 *
 * `template.ftl` is deliberately not in that list: this theme replaces it, so the
 * hooks only it reads are ours to spell literally rather than to route through a
 * properties file. Written down here rather than left implicit, because the cost
 * of a hook nobody defined is an element with no class and a page that renders
 * un-styled rather than loudly.
 */
const INHERITED_HOOKS = [
  "kcButtonBlockClass",
  "kcButtonClass",
  "kcButtonDefaultClass",
  "kcButtonLargeClass",
  "kcButtonPrimaryClass",
  "kcCheckboxInputClass",
  "kcCommonLogoIdP",
  "kcContentWrapperClass",
  "kcFormButtonsClass",
  "kcFormButtonsWrapperClass",
  "kcFormClass",
  "kcFormGroupClass",
  "kcFormOptionsClass",
  "kcFormOptionsWrapperClass",
  "kcFormPasswordVisibilityButtonClass",
  "kcFormPasswordVisibilityIconHide",
  "kcFormPasswordVisibilityIconShow",
  "kcFormSettingClass",
  "kcFormSocialAccountGridItem",
  "kcFormSocialAccountListButtonClass",
  "kcFormSocialAccountListButtonDisabledClass",
  "kcFormSocialAccountListClass",
  "kcFormSocialAccountListGridClass",
  "kcFormSocialAccountNameClass",
  "kcFormSocialAccountSectionClass",
  "kcInputClass",
  "kcInputClassCheckbox",
  "kcInputClassCheckboxInput",
  "kcInputClassCheckboxLabel",
  "kcInputClassRadio",
  "kcInputClassRadioCheckboxLabelDisabled",
  "kcInputClassRadioInput",
  "kcInputClassRadioLabel",
  "kcInputErrorMessageClass",
  "kcInputGroup",
  "kcInputHelperTextAfterClass",
  "kcInputHelperTextBeforeClass",
  "kcInputWrapperClass",
  "kcLabelClass",
  "kcLabelWrapperClass",
];

/**
 * This type's `theme.properties`, taken from the emitted set rather than from
 * the module that spells it, because the merge with the brand's keys happens in
 * `src/theme.ts` and is the half a type does not do for itself.
 */
const emitted = themeTypes().find(({ type }) => type === "login");
const properties = emitted?.properties ?? "";

describe("theme.properties", () => {
  it("inherits Keycloak's own login templates rather than restating their logic", () => {
    // `base` is the theme that carries the flow — the sign-in form, registration,
    // the reset-password chain, the error pages — with no styling of its own.
    // Inheriting it is what keeps this workspace to a stylesheet and one layout
    // instead of a fork of Keycloak's authentication screens.
    expect(properties).toContain("parent=base\n");
    expect(properties).toContain("styles=css/login.css\n");
  });

  it("carries the brand, so no template here holds a second copy of the name", () => {
    expect(properties).toContain(`brandName=${brand.name}\n`);
    expect(properties).toContain(`brandDomain=${brand.domain}\n`);
    expect(properties).toContain(`brandSupportEmail=${brand.supportEmail}\n`);
    // Escaped, because the tagline has an "é" in it and a properties file is
    // read as one of two charsets. `properties.test.ts` is where that is argued.
    expect(properties).toContain("brandTagline=Herplaats je Marktplaats");
    expect(properties).not.toContain("één");
  });

  it("defines every hook the inherited templates read", () => {
    for (const hook of INHERITED_HOOKS) {
      expect(Object.keys(HOOKS), hook).toContain(hook);
    }
  });

  it("names no class that nothing styles", () => {
    // The failure this catches is the quiet one: a hook pointing at `mp-inupt`
    // does not throw, it renders an input with no border on a page nobody looked
    // at before a release.
    const styled = `${componentCss}\n${loginCss}`;
    for (const [hook, value] of Object.entries(HOOKS)) {
      for (const name of value.split(/\s+/).filter(Boolean)) {
        expect(name, `${hook} → ${name}`).toMatch(/^(mp|login)-/);
        expect(styled, `${hook} → ${name}`).toMatch(new RegExp(`\\.${name}\\b`));
      }
    }
  });

  it("hands Keycloak's controls the design system's own classes", () => {
    // The point of the whole arrangement: the field on this page is `.mp-input`,
    // not a `.login-input` drawn to look like one. A change to the sheet reaches
    // this surface the same way it reaches the popup and the site.
    expect(HOOKS.kcInputClass).toBe("mp-input");
    expect(HOOKS.kcLabelClass).toBe("mp-label");
    expect(HOOKS.kcFormGroupClass?.split(/\s+/)).toContain("mp-field");
    expect(HOOKS.kcButtonClass?.split(/\s+/)).toContain("mp-btn");
    expect(HOOKS.kcButtonPrimaryClass).toContain("mp-btn--primary");
    expect(HOOKS.kcCheckboxInputClass).toBe("mp-check");
  });
});

describe("the stylesheet the theme serves", () => {
  it("is the token sheet, the component sheet and this page's rules, in that order", () => {
    // The order is load-bearing twice over: the components read properties the
    // tokens declare, and `.login-stage` repaints a background `.mp-root` sets,
    // which it can only do from later in the same sheet at equal weight.
    const css = loginStylesheet();
    expect(css.indexOf(themeCss)).toBe(0);
    expect(css.indexOf(componentCss)).toBeGreaterThan(0);
    expect(css.indexOf(loginCss)).toBeGreaterThan(css.indexOf(componentCss));
  });
});
