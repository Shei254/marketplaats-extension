import { describe, expect, it } from "vitest";

import brand from "../../../../brand.json";
import { ARGUMENTS, dutchMessages } from "./copy";

const messages = dutchMessages(brand.name);
const entries = Object.entries(messages);

/**
 * The keys `FreeMarkerEmailTemplateProvider` actually looks up, taken out of
 * `org.keycloak.keycloak-services-26.7.1.jar` on 2026-09-19 with
 *
 *   javap -p -c org/keycloak/email/freemarker/FreeMarkerEmailTemplateProvider \
 *     | grep -o '"[a-zA-Z]*Subject"' | sort -u
 *
 * Written down rather than inferred, because an invented or misspelled key is
 * not an error anywhere: Keycloak finds the parent theme's value and the mail
 * goes out in Keycloak's words, looking exactly as intended.
 */
const PROVIDER_KEYS = [
  "emailTestSubject",
  "emailUpdateConfirmationSubject",
  "emailVerificationSubject",
  "executeActionsSubject",
  "identityProviderLinkSubject",
  "orgInviteSubject",
  "passwordResetSubject",
  "verifiableCredentialOfferSubject",
];

/**
 * The markup this copy is allowed to use.
 *
 * Two independent reasons, and the first is the stronger: **Keycloak's own
 * bundles use these**, so they demonstrably survive `kcSanitize` on the exact
 * path these strings take. `KeycloakSanitizerPolicy` is the second — it allows
 * both elements, `href` under `allowStandardUrlProtocols`, and the `style`
 * attribute through `allowStyling`.
 *
 * **What `allowStyling` does not promise is which CSS properties survive**: that
 * is OWASP's own schema, and it is why `styles.ts` draws the button so that a
 * stripped `border-radius` or `display` leaves a padded, coloured, bold link
 * rather than nothing. `docs/click-through.md` is where a human confirms it.
 */
const ELEMENTS = ["p", "a"];
const ATTRIBUTES = ["style", "href"];

describe("the mail's copy", () => {
  it("names only keys Keycloak asks for", () => {
    for (const key of Object.keys(messages)) {
      const subject = key.replace(/(Body|BodyHtml)$/, "Subject");
      expect(PROVIDER_KEYS, key).toContain(subject);
    }
  });

  it("gives every body both of its halves", () => {
    // Keycloak sends `multipart/alternative` and `base/email/text/` has no shell
    // of its own, so an HTML-only override leaves the realm's name in the part
    // plain-text clients render — and in the part a filter compares with the
    // other one.
    for (const key of Object.keys(messages).filter((one) => one.endsWith("BodyHtml"))) {
      expect(messages, key).toHaveProperty(key.replace(/Html$/, ""));
    }
  });

  it("uses no placeholder the provider does not pass", () => {
    // Positional and fixed: `{0}` the link, `{1}` the expiry in minutes, `{2}`
    // the realm name, `{3}` that expiry as words — and for execute-actions `{3}`
    // is the action list and the formatted expiry moves to `{4}`. One index past
    // the end is a `MessageFormat` that renders the brace.
    for (const [key, value] of entries) {
      const used = [...value.matchAll(/\{(\d+)\}/g)].map(([, index]) => Number(index));
      const limit = ARGUMENTS[key];
      expect(limit, `${key} has no entry in ARGUMENTS`).toBeTypeOf("number");
      for (const index of used) {
        expect(index, `${key} → {${index}}`).toBeLessThan(limit ?? 0);
      }
    }
  });

  it("never renders the realm's name, which is the fault it exists to fix", () => {
    // `{2}` is `realm.getDisplayName()` — an administrator's label for the realm,
    // which reads `mprelist (production)`. This bundle exists because the shell
    // cannot reach inside a message to replace it (ADR-0035).
    for (const [key, value] of entries) {
      expect(value, key).not.toContain("{2}");
    }
  });

  it("puts no placeholder in a subject, which is formatted with no arguments", () => {
    for (const [key, value] of entries.filter(([one]) => one.endsWith("Subject"))) {
      expect(value, key).not.toMatch(/\{\d+\}/);
    }
  });

  it("doubles every apostrophe, or the rest of the sentence disappears", () => {
    // `'` opens a quoted section in `java.text.MessageFormat`: one stray
    // apostrophe swallows every placeholder after it and the mail goes out with
    // a literal `{0}` where the link should be. Keycloak's own English writes
    // `account''s` for exactly this reason.
    for (const [key, value] of entries) {
      expect(value.replace(/''/g, ""), key).not.toContain("'");
    }
  });

  it("writes no brace that is not a placeholder", () => {
    for (const [key, value] of entries) {
      expect(value.replace(/\{\d+\}/g, ""), key).not.toMatch(/[{}]/);
    }
  });

  it("uses only markup that survives the sanitizer", () => {
    for (const [key, value] of entries.filter(([one]) => one.endsWith("Html"))) {
      for (const [, element] of value.matchAll(/<\/?([a-z][\w-]*)/g)) {
        expect(ELEMENTS, `${key} → <${element}>`).toContain(element);
      }
      for (const [, attribute] of value.matchAll(/\s([a-z-]+)="/g)) {
        expect(ATTRIBUTES, `${key} → ${attribute}=`).toContain(attribute);
      }
    }
  });

  it("puts no markup in the half that is not markup", () => {
    for (const [key, value] of entries.filter(([one]) => !one.endsWith("Html"))) {
      expect(value, key).not.toMatch(/<[a-z/]/i);
    }
  });

  it("carries the link in both halves, so a blocked button is not a dead end", () => {
    for (const [key, value] of entries.filter(([one]) => one.endsWith("Body") || one.endsWith("BodyHtml"))) {
      expect(value, key).toContain("{0}");
    }
  });

  it("says the product's name and never spells the realm's", () => {
    expect(Object.values(messages).join("\n")).toContain(brand.name);
    expect(Object.values(messages).join("\n")).not.toContain("mprelist");
  });

  it("speaks the product's Dutch rather than Keycloak's", () => {
    // ADR-0035: the popup, `apps/web` and `brand.tagline` all say *je*; the
    // formal *u* is Keycloak's translator's register and not this product's.
    // The sign-in page still says *u* — that seam is deferred by decision, in
    // `docs/backlog.md`, and closing it means owning the login bundle too.
    for (const [key, value] of entries) {
      expect(value, `${key} addresses the reader as "u"`).not.toMatch(/\b(u|uw)\b/i);
    }
  });
});
