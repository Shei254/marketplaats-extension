# ADR-0043: The Language belongs to the device, is carried across every hand-off, and changes only our words

**Status:** Accepted (2026-11-15). Two of its claims are unproven until T94 has run; they are marked below.
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
  synced between them and nothing is stored on the subscription or sent by `/api/me`.
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
- **A mail follows the page that asked for it.** The password reset is requested from a sign-in page that has
  a language *(unproven — T94)*. A mail an operator triggers has no page behind it and is Dutch, the realm's
  default.
- **Stripe's receipts are Stripe's.** We open the first Checkout in the reader's Language and do not manage
  what Stripe records on its customer afterwards *(what it records is unproven — T94)*.
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
  certainly record a language on the account. Declined for one rule over two: the page shows what it was
  handed. The cost is under Consequences.
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

- **Nothing records a language on the account**, so any mail not requested from a page is Dutch. If T94 shows
  the reset mail does not follow the page either, this decision reopens before anything is built on it.
- **A change of Language after subscribing does not reach Stripe's receipts.**
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
