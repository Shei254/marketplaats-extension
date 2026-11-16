# ADR-0043: The Language belongs to the device, is carried across every hand-off, and changes only our words

**Status:** Accepted (2026-11-15). T94 checked its two unproven claims the same day and both came out
differently; the mail and the receipts were re-decided on what was found, and the text below is the corrected one.
**Scope:** every surface a user reads — `apps/web`'s public pages, the popup, the **Page button**, the worker's
sentences, the sign-in page and the mail in `apps/keycloak-theme`, both realm files, and the two API requests
that open Stripe Checkout and the Customer Portal. `/admin` is outside it.
**Refines [ADR-0033](0033-the-login-page-is-ours-and-is-generated.md)**: "Dutch, with one supported locale"
becomes two, and the switcher that page's template draws for a second locale is removed rather than shown.
**Refines [ADR-0035](0035-the-mail-is-ours-and-so-are-the-words.md)**: the mail's words are ours in two
languages now. **Overturns one line of the backlog's store-submission notes**: "`/privacy` stays Dutch".
T93 is the work, in the slices T94–T97.

## Context

Everything a user reads was Dutch, written inline in about a dozen component files, with `lang="nl"` hard-coded
on both pages and `supportedLocales: ["nl"]` in both realms. The reader this is for is **an English-speaking
seller on Marktplaats** — someone who will use the product, not someone evaluating it — so a switch on one
surface is worse than none: an English landing page that hands over to a Dutch popup, a Dutch sign-in page and
a Dutch reset mail has promised something it does not keep. The bar is the whole path.

The surfaces on that path share nothing. The site's storage and the extension's cannot see each other; the mail
has no device; the sign-in page and Stripe's pages take a language as a parameter and remember nothing for us;
and before sign-in there is no account to hold anything.

T93's original quote answered this with the account — Keycloak's own user `locale`, Dutch by default. This ADR
does not, and the terms it uses (**Language**, **Language switch**, **Our words**) are in the glossary.

## Decision

- **The Language belongs to the device.** The site keeps one choice and the extension keeps one. Nothing is
  synced between them and nothing is stored on the subscription or sent by `/api/me`. Keycloak keeps one fact
  of its own beside this — the language an account registered in — and only the mail reads it.
- **Nothing chosen is a state, and it follows the browser — on the site too.** A surface walks the browser's
  language list and takes the first of Dutch or English; a list that names neither gets Dutch. A choice, once
  made, always wins.
- **It is carried, not shared.** Popup to site: `?lang` on the link, which sets the site's choice. Either of
  them to the sign-in page: Keycloak's locale parameter. Either of them to Stripe: an optional field on the two
  requests that open Checkout and the Portal, which the API hands to Stripe — the first time the API learns
  that a language exists, and the only place it does.
- **The site's addresses are the same in both languages.** No `/en/` prefix; the route table, nginx and the
  return URLs the API gives Stripe are untouched.
- **Two Language switches, and no third.** One in the site's navigation bar, one in the popup's header beside
  the theme switch. The **Page button** has none and re-labels when the popup's choice changes, without a
  reload. **The sign-in page only inherits**: `en` becomes a second supported locale and the dropdown the
  template would then draw is taken out.
- **A mail follows the language the account registered in.** Keycloak stores the registration page's language
  on the account and reads it for every mail, the reset and the operator-triggered one alike — its own
  behaviour, taken as it is. Only an account that holds nothing follows the page the mail was asked from, and
  the realm's Dutch after that.
- **Stripe's receipts are Stripe's, and follow the browser the plan was bought from.** Checkout records the
  browser's language ahead of the session's on the customer it creates, and we do not manage it afterwards.
- **Only our words change.** Marktplaats's labels are written as Marktplaats writes them; a **Tier** has one
  name; the brand name, the tagline, the manifest and the Web Store listing stay Dutch. Dates follow the
  Language; **money is written the Dutch way in both** ("€ 9,99").
- **Both legal documents exist in both languages with equal standing.** No sentence says which one governs.
- **The words are held by i18next**, with react-i18next on the React surfaces, catalogs bundled into each build
  and keys typed from the Dutch catalog. Each app holds its own catalogs; the plan sentences, the `Language`
  type and the browser-list rule are shared in `@mprelist/contracts`. Dutch is the source and English is held
  to its keys.
- **Nobody sees a switch until the whole path is English.** Every build before that release is Dutch only.

## Considered options

- **The Language on the account, synced down** (T93's quote). A second laptop turns English on sign-in. It
  costs a field, a write, and a rule for when device and account disagree — and still leaves the signed-out
  landing page and popup needing an answer of their own. Declined: the device model keeps the path whole with
  no new API, and its one weakness is one click on a second machine.
- **The site Dutch until switched.** Googlebot renders as an English browser, so following the browser at one
  address per page most likely gets the English landing page indexed for a product whose market searches in
  Dutch. **Accepted knowingly**: the reader with an English browser gets English with no click.
- **Prefixed English addresses with `hreflang`.** Indexable English, at the price of a doubled route table and
  an API that must know the language to build Stripe's return URLs — and `/` and `/privacy` are published in
  the Web Store listing. Can be added later if English search traffic becomes a goal.
- **Keycloak's own dropdown on the sign-in page.** Already drawn and styled, and the one control that would
  let a reader change the language their account holds. Declined for one rule over two: the page shows what
  it was handed. The cost is under Consequences.
- **Making the mail follow the page**, as this ADR first said it did. It would mean stopping registration from
  storing a language and clearing what accounts already hold. Declined once T94 showed what Keycloak does:
  the stored language also reaches the operator-triggered mail, which the page never could.
- **Setting the Stripe customer's language from the Checkout's**, one more call when a Checkout completes.
  Declined: it changes a receipt, for the reader who chose against their own browser.
- **A governing-language line on the English legal pages.** The usual way to offer a convenience translation.
  Declined; the two stand equally.
- **Money following the Language.** "€1,250.00" for an English reader. Declined: these are amounts on a Dutch
  marketplace, the page beside the popup writes them the Dutch way, and `wording.ts`'s rule that no surface
  spells money two ways now holds across languages as well.
- **A localized manifest and store listing, generated from `brand.json`.** Declined; the brand's strings are
  the brand's, like its name.
- **Typed dictionaries with no library.** Two languages fit in a type, and this repository has declined
  frameworks over small sets before (ADR-0021, `features.ts`). Declined in favour of i18next; typed keys keep
  the compile-time check that was the argument for dictionaries.

## Consequences

- **A reader who registered in Dutch and later switches to English keeps receiving Dutch mail**, from an
  English sign-in page included, and nothing they can press changes it. Every account registered before this
  ships most likely holds Dutch.
- **A reader who chose English against a Dutch browser gets Dutch receipts**, and a later change of Language
  reaches them no more than the first one did. The Portal offers no control for it.
- **One Dutch line sits on the English sign-in page and mail** — the tagline — and the page's meta description
  is Dutch in both, being written before any Language is known.
- **A tier named in Dutch reads in Dutch inside an English sentence**, and on Stripe's Checkout. Naming tiers
  so they read in both is the operator's.
- **The live realm cannot be re-imported** (a realm imports on first start only), so its second locale is a
  field in the admin console, set before the release that shows the switches.
- **`/admin` has no Language.** It is the operator's surface and stays English.
- **The catalogs must be bundled, never fetched**: Manifest V3 and the site's `script-src 'self'` both forbid
  the alternative.
- **A string added later is decided by who wrote it**, not where it appears — the **Our words** test.

## Checked on a throwaway stack and in the sandbox (2026-11-15, T94)

Keycloak 26.7.1 with this repository's realm and theme, `supportedLocales: ["nl", "en"]`, and a local mail
catcher; Stripe's "Bumpr sandbox", which is not production's account. **Two findings contradicted this ADR as
first written** — they are marked — and the operator chose the same day to take both as found, which is
what the Decision above now says.

**Keycloak**

- **`ui_locales` is the parameter, and it carries.** `ui_locales=en` on the authorization request, from a
  browser that asks for Dutch, gives an English sign-in page, an English reset page and an English mail.
  `kc_locale` on the same request does nothing.
- **With no parameter Keycloak already follows the browser the way this ADR's rule does**: a list of Polish,
  English, Dutch gives English, and German alone gives Dutch.
- **Signing in writes no language onto the account. Registering does** — *contradicted "nothing records a
  language on the account"*. The registration form carries a hidden `locale` field holding the page's
  language, and it is stored as the user's `locale`. That field is on today's one-locale realm too, so
  accounts registered through the form most likely hold `nl` already; the two seeded local users hold nothing,
  and production was not looked at.
- **A stored language beats the page for the mail** — *contradicted "a mail follows the page that asked for
  it"*. An account holding `nl`, resetting from an English sign-in page, reads English pages and receives a
  Dutch mail; holding `en` and resetting from a Dutch page, an English one. The mail follows the page only for
  an account that holds nothing.
- **The link in the mail carries no language.** Opened in a browser other than the one that asked, the
  new-password page follows that browser.
- **The English mail is Keycloak's own** ("Reset password") until T96 writes ours. *(T96 has: "Reset your
  password", `apps/keycloak-theme/src/email/copy.ts`.)*

**Stripe**

- **`locale=en` on the session gives an English Checkout in a Dutch browser**, and the same on a Portal
  session gives an English Portal.
- **The customer Checkout creates records the browser first and the session second** — `preferred_locales`
  came back `["nl-NL", "en"]` for an English session paid from a Dutch browser, and `["en-US"]` with no
  locale from an English one. *So opening the first Checkout in the reader's Language does not decide the
  receipts*: for a reader who chose against their browser, Stripe's stored first preference is the browser's.
- **A Portal opened without a locale follows that stored preference**, not the browser — Dutch in a German
  browser for the customer above. The hosted invoice page follows whichever browser opens it.
- **A subscriber cannot change it.** The Portal's customer updates are name, e-mail, address and phone.
- **Not observed:** the language of a receipt mail itself. The sandbox sends none; that it follows the first
  stored preference is Stripe's documented behaviour, not something seen here.
