# ADR-0035: The mail that page sends is ours too, and owning it means owning the words

**Status:** Accepted (2026-09-19)
**Scope:** a second theme type in [`apps/keycloak-theme`](../../apps/keycloak-theme) — `src/email/` and the
`messages` field the registry in [`src/theme.ts`](../../apps/keycloak-theme/src/theme.ts) gains for it — plus
the `emailTheme` and `smtpServer.fromDisplayName` that [`infra/keycloak/mprelist-realm.json`](../../infra/keycloak/mprelist-realm.json)
and [`infra/keycloak-production/mprelist-realm.json`](../../infra/keycloak-production/mprelist-realm.json) now
carry, the assertions `KeycloakRealmTest` and `ProductionRealmTest` hold them with, and one step each in
[`infra/deploy/mprelist-deploy`](../../infra/deploy/mprelist-deploy) and
[`infra/deploy/mprelist-wizard`](../../infra/deploy/mprelist-wizard).
**Refines [ADR-0033](0033-the-login-page-is-ours-and-is-generated.md) in its *first* half** — the half
[ADR-0034](0034-the-deployment-tree-ships-with-the-tag.md) left alone. 0033 said the sign-in page is a surface
of ours and is generated; this asks the same question one page later, where the mechanism that made it cheap
does not exist.
**Refines [ADR-0021](0021-design-system-stays-ours.md)**, which said the design system is ours and is a CSS
string, and is now asked what it can be on a surface that has no stylesheet.
T82 is the work.

**The decision is that the mail Keycloak sends is one of this product's screens**, that a **single replaced
shell** frames every one of them, that — because `base/email` has no class hooks and no styling to point at
anything — **the copy becomes ours**, generated from `brand.json` into our own message bundle; that the design
system therefore contributes **values and not rules** here; and that the one thing no theme can reach, the
name on the envelope, is **a literal in the realm file held by a live test** rather than a copy nobody is
holding.

## Context

ADR-0033 ended with a sentence about what came next, and that sentence is wrong. It says — and so do
`apps/keycloak-theme/README.md`, `src/theme.ts`'s own javadoc and `infra/README.md` — that the password-reset
mail "goes out in Keycloak's own English template". It does not. `theme/base/email/messages/messages_nl.properties`
ships inside `org.keycloak.keycloak-themes-26.7.1.jar`, both realms are `internationalizationEnabled` with
`defaultLocale: nl` and one supported locale, and `FreeMarkerEmailTemplateProvider` resolves the locale off
the user and falls back to the realm's. **The mail has been Dutch all along.** The error survived because
nobody had read the mail; it was reasoned from the login page, where the same claim *was* true.

What is actually wrong with it is four things, and only the second is the one anybody expected:

- **It names the realm.** The body is `msg("passwordResetBodyHtml", link, linkExpiration, realmName, …)`, and
  `realmName` is `realm.getDisplayName()` falling back to `capitalize(realm.getName())`. Both exports set
  `displayName`, so a customer is told about *"uw **mprelist (production)** account"* — the internal
  identifier this repository is careful never to show, with an environment label after it, one screen after
  the page T80 spent a ticket getting the brand onto.
- **It has no design at all.** `base/email/html/template.ftl` is a macro that emits `<html><body>` and nests
  the body into it. The default email theme, `keycloak`, is `parent=base` plus a handful of message
  overrides — it adds nothing. What arrives is two unstyled paragraphs and a blue underlined link.
- **It comes from nobody.** `smtpServer` carries no `fromDisplayName`, so the inbox row shows a bare
  address — and the inbox row is read by more people than the body is.
- **It says *u*.** Keycloak's Dutch is formal. This product's Dutch is not: the popup, `apps/web` and
  `brand.tagline` all say *je*, *jouw*, *je advertenties*.

### The mechanism that made the login page cheap does not exist here

ADR-0033's decision was *"Keycloak's templates in our clothes rather than our templates doing Keycloak's
job"*, and what made that possible was that every control in `base/login` is written
`class="${properties.kcInputClass!}"`. A theme decides what those classes *are*, so the button on the login
page **is** the button `componentCss` draws, and not one word of Keycloak's copy had to be touched.

**`base/email` has no `kc…Class` hooks.** There is nothing in it to point anywhere. The body of every mail is
one `msg()` string, markup included — the HTML *is* the translation. So "our clothes" buys a `<body>` wrapper
and stops. Anything past that means owning either the templates or the words, and this ADR is mostly about
discovering that those are the only two options and picking the second.

## Options weighed

### How much of the mail

**1. Leave it and fix the name.** Set `displayName` from the brand and stop. It is one word in two files and
it is the exact regression `ProductionRealmTest`'s javadoc was written about — see *The envelope* below. It
also leaves a mail with no design in a product that has one.

**2. Replace `html/password-reset.ftl` only.** Four lines, narrowly what was asked for. The next mail turned
on — email verification, which `infra/README.md` says is deliberately off only until real SMTP exists —
arrives unframed, and the frame has to be retrofitted then.

**3. Replace the shell, `html/template.ftl`, and nothing else.** Every mail Keycloak sends is framed at once,
including ones not yet enabled. What was chosen, as the structure.

**4. Replace every per-mail template too.** Full control of markup, including a table-based button that
survives Outlook desktop. It is a fork of a product we upgrade, per mail, for markup that is four lines long
in each — the same objection 0033 made to writing `login.ftl`, at a much worse ratio.

### How the brand reaches the body

**5. `realm.displayName`.** Rejected above and below.

**6. Fork the per-mail templates and pass `properties.brandName` where `realmName` would go.** Genuinely
clever: Keycloak's Dutch copy stays verbatim and stays theirs, and the argument list is the only thing that
changes. It is option 4 in disguise — a file per mail — and it leaves the subject line, which takes no
arguments, still unbranded.

**7. Our own generated message bundle.** What was chosen. `src/email` emits
`messages/messages_nl.properties` the way it already emits `theme.properties`, written from `brand.json` by
the build. The brand is in a *generated* file, which is what this repository already accepts everywhere else;
the subject line can carry it; and the `é` in Dutch copy is handled by the `\uXXXX` escaping
`src/properties.ts` already exists to do, which is the only reason the ambiguity between `Properties.load`'s
ISO-8859-1 and a UTF-8 `Reader` never has to be settled.

### What the design system can contribute

**8. Its sheets.** `themeCss` is `:root { --mp-…: … }` and every rule in `componentCss` reads `var(--mp-…)`.
Mail clients are not browsers: Gmail's sanitizer keeps no `:root` rule and drops declarations it cannot
resolve, so the mail that is *most* faithful to ADR-0021 is the one that renders as unstyled text for most
recipients. Shipping the sheets *and* inline fallbacks is worse than either: two spellings of the same
styling, where the one actually seen is the second.

**9. Its values.** `palette`, `text`, `space` and `radius` are exported as plain JavaScript. The build reads
them and writes literal `style="…"`. The design system stays the only place a colour is written down;
it just stops being the place the rules are. Chosen.

### The mark

**10. An `<img>` on `brand.domain`.** Email themes get no `url` in their attribute map and theme `resources/`
are never served over HTTP, so an image must be an absolute external URL; `data:` is blocked by Gmail and
Outlook, and Keycloak's sender has no route to a CID attachment. `apps/web` already resizes site icons from
`brand.json`'s master, so the file is one entry in `SITE_ICONS` and the host is `properties.brandDomain`,
already a theme property. **What kills it is time, not cost:** a sent mail is permanent, and `brand.domain` is
`www.187-7-19-175.nip.io` — a hostname derived from a VPS IP address that `brand.json` itself calls
provisional and T56 is booked to replace. Every mail sent before that move would point at it for ever.

**11. A wordmark.** The brand name as styled text. Chosen, and reversible into option 10 in one line once
there is a domain worth embedding.

> **Amended 2026-09-23.** There is. T56 moved `adbump.nl` onto the VPS and `brand.domain` with it, so the
> objection option 10 was refused on — that every mail sent would point at a hostname carrying a VPS IP
> address, for ever — no longer holds. Nothing about this decision was wrong; its condition has simply been
> met, and the choice between 10 and 11 is now an ordinary scope call rather than a permanence one.

### The envelope

**12. `fromDisplayName` as a literal in the realm exports.** A hand-written copy of the brand in the one file
whose hand-written copy of the brand went stale — `ProductionRealmTest` carries the story: a test asserting
`displayName` equalled `brand.json`'s `name` had been **commented out**, and the file drifted to `Bumpr`.

**13. The same literal, with the test live.** Chosen. `brand.json`'s own rule is *"the test is drift, not
whether a file is in git"*, and it is what makes the committed theme directory legitimate. The copy that
drifted was the copy nobody was holding. Both realm tests now read `brand.json` and fail with a message that
names this history.

**14. `"${MPRELIST_SMTP_FROM_NAME:}"`.** No copy in the realm file at all. It puts the product's name among
an operator's credentials, and leaves a local stack with no sender name until a developer sets one — so the
thing a developer sees while building this is not the thing a customer gets.

## Decision

**`email` is the second theme type, and it is one shell.** `src/email/html/template.ftl` replaces
`base`'s and frames every HTML mail the realm can send. `parent=base`, as `login` is.

**The copy is ours, generated, and Dutch in the product's register.** `src/email` emits
`messages/messages_nl.properties` holding `passwordReset{Subject,Body,BodyHtml}` and
`executeActions{Subject,Body,BodyHtml}` — the two mails a customer can receive. `emailTest*` stays
Keycloak's: it goes to an administrator pressing **Test** in the console, and branding a diagnostic is
decoration. **Both halves of every key**, because Keycloak sends `multipart/alternative` and `base/email/text/`
has no shell of its own — override only the HTML and the plain-text alternative goes on naming the realm, in
the part plain-text clients render and spam filters compare against the other one.

**It says *je*.** That matches the popup, `apps/web` and the tagline, and it is the register the artefact that
sits in an inbox for months should be in. It opens a seam — the login page still runs on Keycloak's formal
Dutch — and that seam is recorded rather than tolerated silently; see *Consequences*.

**The call to action is a styled anchor inside the message**, drawn by one helper in `src/email` so the six
strings share a spelling rather than repeat one. This is the one place the theme is subject to something the
login page is not: `password-reset.ftl` pipes its message through `kcSanitize`, and
`KeycloakSanitizerPolicy` is an allowlist. It calls `allowStyling`, so inline `style` survives; it also
rewrites links with `rel="nofollow"` and drops any element or attribute it does not know. **Markup in the
shell is unrestricted and markup in a message is not**, and that asymmetry is the thing to remember when the
mail looks right in a preview and wrong in an inbox.

**The design system contributes values.** `palette`, `text`, `space` and `radius`, read at build time and
written as literal inline styles. No `var()`, no `<style>`, no sheet. **Light only:** clients that force dark
invert it themselves, and `BRAND_MARK` is deliberately identical in both themes anyway. **Wordmark, no
image.**

**The registry gains a typed `messages` field**, `Record<locale, Record<key, string>>`, rendered through the
existing `propertiesFile()`. The build still decides nothing — it writes what the registry hands it — and the
copy stays readable to the suite as data rather than as a parsed artefact.

**`scripts/build.mjs` copies templates recursively.** It cannot not: a Keycloak email theme's templates live
under `html/` and `text/`, and today's copy is one flat `readdir`. This falsifies two sentences that were
true when they were written — the README's *"`scripts/build.mjs` changes not at all"* and this repository's
*"adding a type is a directory and a line"* — and they are rewritten rather than left to age.

**Both realms name the theme and the sender.** `"emailTheme": "mprelist"` and
`smtpServer.fromDisplayName` set to `brand.json`'s name, asserted in both realm tests.

**Verification is data-level, and then a human reads a mail.** In the workspace: the overridden keys are a
subset of a dated list of the keys Keycloak actually asks for; no `MessageFormat` placeholder exceeds the
arguments Keycloak passes (`{0}`–`{3}` for a reset, `{0}`–`{4}` for execute-actions); no un-doubled
apostrophe, which is why Keycloak's own English writes `account''s` and is a failure that silently eats the
rest of a sentence; markup inside a dated allowlist taken from `KeycloakSanitizerPolicy`; every colour traced
to `palette`; and `build.test.ts` gains the recursive case. **No rendered-mail integration test**, because
starting a Keycloak against this workspace's build output is the Gradle/npm boundary
[ADR-0011](0011-repository-layout.md) draws and that `ProductionRealmTest` explicitly relies on. The mail
itself is read by a person, in Mailtrap, as a step in `docs/click-through.md` — the same treatment the look
of the login page gets, and for the same reason.

## Consequences

- **`down -v` on every local stack, once.** `emailTheme` is a realm property and a realm imports on first
  start only. This is the second time this workspace has cost that, and `infra/README.md` § Resetting already
  names it.
- **Production will not pick it up from the file, and cannot be probed.** The realm there already exists.
  ADR-0034's deploy check fetches the sign-in page and greps for a class, which works because a page can be
  fetched; there is no mail to fetch, and reading `emailTheme` over the admin API needs the bootstrap account
  `production.env.example` tells you to stop using — refused by name in ADR-0034 and refused again here.
  So the existing warning names **both** settings, and `mprelist-wizard`'s theme stage gains the second one.
  Documented, not enforced, which is now the treatment three separate things get.
- **And nothing will be seen there anyway until somebody configures mail.** `production.env.example`'s entire
  Mail block is commented out, so `MPRELIST_SMTP_HOST` is absent, `${MPRELIST_SMTP_HOST:}` resolves to
  nothing and no reset mail is sent at all. `MPRELIST_SMTP_FROM` defaults to `no-reply@mprelist.invalid`, a
  reserved TLD that can never authenticate. **This ADR ships something correct and invisible** until go-live
  fills that block in, and that is not a reason to delay it: the mail is what the block turns on.
- **Six strings of Dutch are now ours to keep true**, in two forms each. Keycloak's translations stop being
  free for exactly these keys and go on being free for every other string in every other mail. A second
  supported locale — deferred, and still deferred — would need a twin bundle, which is the real recurring
  cost of this decision.
- **A Keycloak upgrade gains a third check here.** `src/login/theme.test.ts` already carries the
  `kc…Class` hook list; this adds the message keys the provider asks for and the sanitizer's allowlist, both
  dated and both with the command that produced them. A release that renames a key leaves a mail rendering
  Keycloak's copy rather than failing.
- **The admin's test mail is framed and not written.** `emailTest*` stays Keycloak's, inside our shell. That
  is the shell working as intended rather than an oversight.
- **A seam in the flow: the mail says *je* and the login page says *u*.** Owning the login theme's message
  bundle closes it, and is deliberately not in this ticket — that is taking over Keycloak's Dutch for the
  sign-in, registration and reset screens, which is a different size of decision. It is recorded in
  `docs/backlog.md` § *Still deferred by decision* with this ADR as the reason.
- **ADR-0021's claim narrows, on this surface only.** The design system stays ours and stays a CSS string
  everywhere a browser renders it. In an inbox it is a set of values. That is a real loss — a change to
  `componentCss`'s button reaches the popup, `apps/web` and the login page, and does not reach here unless it
  was a change to a token.
- **ADR-0033's sentence about this mail stays as written.** It is a dated record and this repository does not
  rewrite those — ADR-0034 amended 0033 by writing a document and saying so. The three *living* copies of
  that claim (`apps/keycloak-theme/README.md`, `src/theme.ts`, `infra/README.md`) are corrected, and so is
  the T80 backlog entry, with the correction shown rather than performed silently.

## Revisit if

A second locale is supported, at which point the copy is a bundle per locale and the case for owning it at
all gets weighed again against what Keycloak translates for free — or `brand.domain` becomes a real domain
(T56), at which point the mark is one entry in `SITE_ICONS` and one `<img>` in the shell and option 10 above
is where to start — or this product needs to send a mail Keycloak does not, at which point the frame stops
belonging to a Keycloak theme and the question is where it moves to.
