import {
  asideStyle,
  buttonRowStyle,
  buttonStyle,
  paragraphStyle,
  signatureStyle,
  urlStyle,
} from "./styles";

/**
 * Every word this product sends by mail.
 *
 * **Owning the copy is not a decoration on this theme; it is the theme.**
 * `base/login` writes every control `class="${properties.kcInputClass!}"`, so the
 * sign-in page could be made ours without touching one of Keycloak's strings.
 * `base/email` has no hooks at all: the body of each mail is a single `msg()`
 * lookup whose value carries its own markup, so there is nothing to point
 * anywhere and the words are the only thing there is to own (ADR-0035).
 *
 * **Generated, so the brand is not copied here.** These are functions of
 * `brand.json`'s name, the way `theme.properties` already is — which is what lets
 * a rename stay the one-file edit T48 made it, and what keeps the product out of
 * `realmName`, whose value is the realm's administrative label and reads
 * `mprelist (production)`.
 *
 * **In `je`, which is a decision and not a slip.** Keycloak's own Dutch is
 * formal; the popup, `apps/web` and `brand.tagline` are not. The mail is the
 * artefact that sits in an inbox for months, so it is the wrong one to concede.
 * The sign-in page still runs on Keycloak's `u` — that seam is deferred by
 * decision and recorded in `docs/backlog.md`, not overlooked.
 *
 * ## Two traps, both silent
 *
 * **Apostrophes.** These values are `java.text.MessageFormat` patterns, where `'`
 * opens a quoted section — a single stray one swallows every placeholder after
 * it and the mail goes out with a literal `{0}` where the link should be. It is
 * why Keycloak's own English writes `account''s`. Nothing here uses one, and
 * `copy.test.ts` keeps it that way.
 *
 * **Placeholder indexes.** They are positional and fixed by the provider:
 * a reset is given `{0}` the link, `{1}` the expiry in minutes, `{2}` the realm
 * name and `{3}` that expiry as words; execute-actions inserts the action list at
 * `{3}` and moves the formatted expiry to `{4}`. **A subject is given none at
 * all** — `FreeMarkerEmailTemplateProvider` formats it with an empty argument
 * list — so a subject containing `{0}` renders the brace rather than a value.
 */

/** `&` and `"` as an HTML attribute reads them back. */
function attribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * A paragraph of the body.
 *
 * Every text element is styled rather than leaning on the cell it sits in:
 * inheritance into `<p>` is not something every client agrees about, and Outlook
 * substitutes its own face and its own margins for the ones it was not given.
 */
const p = (style: string, content: string): string =>
  `<p style="${attribute(style)}">${content}</p>`;

/**
 * The call to action, wrapped in its own centred row.
 *
 * `{0}` is the link, written the way `base/email` writes it — a bare `&` in the
 * query string and no entity, because that is the exact shape Keycloak's own
 * templates put through `kcSanitize`, and `KeycloakSanitizerMethod.fixURLs`
 * exists to repair what the sanitizer does to it. A cleverer spelling here would
 * be off that proven path for no gain.
 */
const button = (label: string): string =>
  p(buttonRowStyle, `<a href="{0}" style="${attribute(buttonStyle)}">${label}</a>`);

/** "the button did not work" — the link again, as something to copy, after the sentence that says so. */
const fallback = (sentence: string): string => p(paragraphStyle, sentence) + p(urlStyle, "{0}");

/**
 * The bundle, in Dutch — the source, which {@link englishMessages} follows key
 * for key.
 *
 * Only the keys a *customer* can be sent. `emailTest*` stays Keycloak's — it goes
 * to whoever pressed **Test** on the SMTP settings in the admin console, and
 * branding a diagnostic is decoration. `emailVerification*` is not here because
 * `verifyEmail` is off in both realms; when it is turned on at go-live it needs
 * its twin of these, and it inherits the frame either way.
 *
 * **Both halves of every message.** Keycloak sends `multipart/alternative` and
 * `base/email/text/` has no shell of its own, so overriding only the HTML would
 * leave `mprelist (production)` in the part plain-text clients render — and in
 * the part a spam filter compares against the other one.
 */
export function dutchMessages(brandName: string): Record<string, string> {
  return {
    // — Password reset. Self-service, from the sign-in page's "Forgot password?".
    passwordResetSubject: `Je wachtwoord opnieuw instellen · ${brandName}`,
    passwordResetBodyHtml:
      p(
        paragraphStyle,
        `Er is gevraagd om het wachtwoord van je ${brandName}-account opnieuw in te stellen. `
          + "Was jij dat? Kies dan hieronder een nieuw wachtwoord.",
      )
      + button("Nieuw wachtwoord kiezen")
      + p(paragraphStyle, "Deze link verloopt over {3}.")
      + fallback("Werkt de knop niet? Kopieer deze link naar je browser:")
      + p(
        asideStyle,
        "Heb je dit niet aangevraagd? Dan hoef je niets te doen. "
          + "Je wachtwoord blijft zoals het is.",
      )
      + p(signatureStyle, `— ${brandName}`),
    passwordResetBody:
      `Er is gevraagd om het wachtwoord van je ${brandName}-account opnieuw in te stellen.\n`
      + "Was jij dat? Kies dan een nieuw wachtwoord via deze link:\n"
      + "\n"
      + "{0}\n"
      + "\n"
      + "Deze link verloopt over {3}.\n"
      + "\n"
      + "Heb je dit niet aangevraagd? Dan hoef je niets te doen. "
      + "Je wachtwoord blijft zoals het is.\n"
      + "\n"
      + `— ${brandName}\n`,

    // — Execute actions. Sent when an administrator asks an account to be
    //   brought up to date; `{3}` is the list of what has to happen, in
    //   Keycloak's own words, which is why it is dropped in mid-sentence.
    executeActionsSubject: `Werk je account bij · ${brandName}`,
    executeActionsBodyHtml:
      p(
        paragraphStyle,
        `Er is gevraagd om je ${brandName}-account bij te werken. Het gaat om: {3}.`,
      )
      + button("Account bijwerken")
      + p(paragraphStyle, "Deze link verloopt over {4}.")
      + fallback("Werkt de knop niet? Kopieer deze link naar je browser:")
      + p(
        asideStyle,
        "Wist je hier niets van? Dan hoef je niets te doen. "
          + "Er verandert dan niets aan je account.",
      )
      + p(signatureStyle, `— ${brandName}`),
    executeActionsBody:
      `Er is gevraagd om je ${brandName}-account bij te werken. Het gaat om: {3}.\n`
      + "\n"
      + "Dat regel je via deze link:\n"
      + "\n"
      + "{0}\n"
      + "\n"
      + "Deze link verloopt over {4}.\n"
      + "\n"
      + "Wist je hier niets van? Dan hoef je niets te doen. "
      + "Er verandert dan niets aan je account.\n"
      + "\n"
      + `— ${brandName}\n`,
  };
}

/**
 * The bundle, in English (T96, ADR-0043) — the same keys as the Dutch, the same
 * placeholders in the same places, and the same register: plain, and addressed
 * to the reader.
 *
 * **Which of the two a customer receives is their account's, not the page's.**
 * Keycloak stores the language of the page an account registered from and reads
 * it for every mail (T94), so a reader who registered in Dutch keeps Dutch mail
 * from an English sign-in page. Only an account holding nothing follows the page.
 *
 * Written without one apostrophe — *did not*, never *didn't* — because English
 * reaches for them far more often than Dutch does, and each one is the
 * `MessageFormat` trap above.
 */
export function englishMessages(brandName: string): Record<string, string> {
  return {
    // — Password reset.
    passwordResetSubject: `Reset your password · ${brandName}`,
    passwordResetBodyHtml:
      p(
        paragraphStyle,
        `Someone asked to reset the password of your ${brandName} account. `
          + "Was that you? Then choose a new password below.",
      )
      + button("Choose a new password")
      + p(paragraphStyle, "This link expires in {3}.")
      + fallback("Does the button not work? Copy this link into your browser:")
      + p(
        asideStyle,
        "Did you not ask for this? Then there is nothing you need to do. "
          + "Your password stays as it is.",
      )
      + p(signatureStyle, `— ${brandName}`),
    passwordResetBody:
      `Someone asked to reset the password of your ${brandName} account.\n`
      + "Was that you? Then choose a new password through this link:\n"
      + "\n"
      + "{0}\n"
      + "\n"
      + "This link expires in {3}.\n"
      + "\n"
      + "Did you not ask for this? Then there is nothing you need to do. "
      + "Your password stays as it is.\n"
      + "\n"
      + `— ${brandName}\n`,

    // — Execute actions. `{3}` is Keycloak's own list of what has to happen.
    executeActionsSubject: `Update your account · ${brandName}`,
    executeActionsBodyHtml:
      p(
        paragraphStyle,
        `Someone asked for your ${brandName} account to be updated. It is about: {3}.`,
      )
      + button("Update account")
      + p(paragraphStyle, "This link expires in {4}.")
      + fallback("Does the button not work? Copy this link into your browser:")
      + p(
        asideStyle,
        "Did you not know about this? Then there is nothing you need to do. "
          + "Nothing changes on your account.",
      )
      + p(signatureStyle, `— ${brandName}`),
    executeActionsBody:
      `Someone asked for your ${brandName} account to be updated. It is about: {3}.\n`
      + "\n"
      + "You can do that through this link:\n"
      + "\n"
      + "{0}\n"
      + "\n"
      + "This link expires in {4}.\n"
      + "\n"
      + "Did you not know about this? Then there is nothing you need to do. "
      + "Nothing changes on your account.\n"
      + "\n"
      + `— ${brandName}\n`,
  };
}

/**
 * What each key is handed, by index, as `FreeMarkerEmailTemplateProvider` calls
 * it — the list `copy.test.ts` holds the copy above to.
 *
 * Read off Keycloak 26.7.1 on 2026-09-19, from the templates the provider names:
 *
 * ```bash
 * unzip -p /opt/keycloak/lib/lib/main/org.keycloak.keycloak-themes-<version>.jar \
 *   'theme/base/email/html/*.ftl' | grep -o 'msg("[^"]*"[^)]*)'
 * ```
 */
export const ARGUMENTS: Record<string, number> = {
  passwordResetSubject: 0,
  passwordResetBody: 4,
  passwordResetBodyHtml: 4,
  executeActionsSubject: 0,
  executeActionsBody: 5,
  executeActionsBodyHtml: 5,
};
