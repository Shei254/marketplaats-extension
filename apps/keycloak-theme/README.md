# `@mprelist/keycloak-theme`

The Keycloak theme this product's own Keycloak pages are drawn in. There are two of them: the **sign-in
flow**, the page `launchWebAuthFlow` opens and the first screen a user ever sees (T80,
[ADR-0033](../../docs/adr/0033-the-login-page-is-ours-and-is-generated.md)), and the **mail** a forgotten
password sends (T82, [ADR-0035](../../docs/adr/0035-the-mail-is-ours-and-so-are-the-words.md)).

```bash
npm run build -w @mprelist/keycloak-theme   # → theme/mprelist/{login,email}/
npm test -w @mprelist/keycloak-theme
```

## What this workspace is

A **build**, not an app. Nothing here runs: `npm run build` writes a directory that Keycloak reads as a
theme, and the only pages it produces are ones a Java process renders.

```
theme/mprelist/login/
  theme.properties                 parent=base, the brand's four values, and every kc…Class hook
  template.ftl                     the one template this type replaces
  resources/css/login.css          the token sheet + the component sheet + this page's rules
  resources/img/*.png              the mark at the sizes template.ftl asks for
theme/mprelist/email/
  theme.properties                 parent=base, the brand's four values, and this surface's inline styles
  html/template.ftl                the shell every mail is framed in
  messages/messages_nl.properties  the words
```

The mail has **no `resources/` and no icons**, and that is not an omission: a theme's resources are served
over HTTP to a browser, and a mail is rendered once and handed to an SMTP server with no URL to fetch from.

**Every byte of it is derived** from `brand.json` and `@mprelist/ui`, so renaming the product or redrawing
the mark stays the one-file edit T48 made it.

**And it is committed — the one committed build output in this repository.** That is not an exception to the
no-copies rule; it is what the rule actually says. A copy is a problem because it can *disagree* with what it
was copied from, and CI reruns this build and fails on any difference (`git diff --exit-code`), so this
directory is a cache of those two files rather than a second spelling of them. The build is byte-reproducible,
PNGs included. **Run it after editing anything here and commit what it writes.**

It is committed because **both ends of it read a directory nobody built**. Locally that directory is your
working tree — the compose file bind-mounts it straight out of `apps/keycloak-theme/theme`, so a clone has to
have it before anyone has run a build. On the deployed host it is put there by `mprelist-deploy`, out of the
`deploy` package CI builds from this same committed copy, because that host has no Node and compiles nothing
([ADR-0023](../../docs/adr/0023-ci-builds-the-images-and-the-host-pulls.md)). It reached that host out of the
host's own git checkout until T81 and now travels as image content
([ADR-0034](../../docs/adr/0034-the-deployment-tree-ships-with-the-tag.md)), which changed the delivery and
not the rule. Both compose files bind-mount the same directory at `/opt/keycloak/themes`, so there is no
Keycloak image of ours and only one delivery to reason about.

## How it is ours without being a fork

Keycloak's `base` theme carries the *flow* — sign-in, registration, the reset chain, the error and info pages
— and styles none of it. Every control in those templates is written `class="${properties.kcInputClass!}"`,
so a theme decides what those classes **are**. `src/login/index.ts` points them at the design system's own:

| Keycloak asks for | It gets |
|---|---|
| `kcInputClass` | `mp-input` |
| `kcLabelClass` | `mp-label` |
| `kcFormGroupClass` | `mp-field login-group` |
| `kcButtonClass` + `kcButtonPrimaryClass` | `mp-btn mp-btn--rect` + `mp-btn--primary` |

So the button on the login page **is** the button `componentCss` draws, and a change to the sheet arrives here
the way it arrives in the popup. What is left in `src/login/css.ts` is the shapes Keycloak's markup has that
no other consumer of that package does — a card on a stage, a password field with a reveal button inside it,
an error under one field.

Exactly one template is replaced, `src/login/template.ftl`, and it is the shell: the card, the mark, the name
and the footer. Writing the others would be forking the authentication screens of a product we upgrade.

## Adding a theme type

A Keycloak theme is `<name>/<type>/`, and the types — `login`, `email`, `account`, `admin`, `welcome` — are
independent of each other. **One is a directory and a line**:

1. `src/<type>/index.ts`, exporting a `ThemeType`: its `theme.properties` entries, its message bundles, its
   resources, its icons.
2. Its `.ftl` files beside it in `src/<type>/`, at whatever depth Keycloak reads them from — flat for
   `login`, under `html/` for `email`. The directory is named for Keycloak's own spelling of the type,
   because that name is both what the build emits and what the realm setting selects.
3. One entry in `TYPES` in `src/theme.ts`.

`scripts/build.mjs` decides nothing and walks whatever the registry holds. **It changed exactly once**, for
`email`: it listed one level of `.ftl` files where it now walks them, because an email theme's templates are
nested by medium. That was the whole cost of the second type outside its own directory. The realm then names
it (`emailTheme`, `accountTheme`, …) the way `loginTheme` names the first.

## Why the mail is a different shape

Everything above is the *login* type, and none of its mechanism exists in `base/email`. **There are no
`kc…Class` hooks there at all**: the body of each mail is a single `msg()` lookup whose value carries its own
markup. There is nothing to point at the design system, so owning the mail means owning the **words** — which
owning the sign-in page required none of.

So `src/email` is three decisions the login type never had to make ([ADR-0035](../../docs/adr/0035-the-mail-is-ours-and-so-are-the-words.md)):

| | |
|---|---|
| **The copy is ours** | `copy.ts` generates `messages_nl.properties` from `brand.json`, for the two mails a customer can receive. It is what keeps `realmName` — an administrator's label, reading `mprelist (production)` — out of a sentence a customer reads, and it is why the mail says *je* where Keycloak's Dutch says *u* |
| **The sheet is values, not rules** | `themeCss` is `:root { --mp-…: … }` and every component rule reads `var(--mp-…)`. Gmail keeps no `:root` rule and resolves no custom property, so `styles.ts` rewrites the rules as inline declarations and reads every *value* from `@mprelist/ui`. A change to a token reaches the mail; a change to `componentCss` does not |
| **No mark, and light only** | The wordmark and nothing else — an `<img>` would need an absolute URL, and `brand.domain` is still a hostname derived from a VPS IP while a sent mail is permanent. One palette, because a mail carries no theme switch and `BRAND_MARK` is the same in both halves anyway |

**Two silent traps live in that bundle**, and `copy.test.ts` pins both. A lone `'` opens a quoted section in
`java.text.MessageFormat` and swallows every placeholder after it — which is why Keycloak's own English
writes `account''s`. And the placeholder indexes are positional and fixed by the provider: `{0}` the link,
`{2}` the realm name nothing here may use, `{3}` the expiry in words — one past the end renders a brace.

## The files

| | |
|---|---|
| `src/theme.ts` | The theme's name, the artwork it draws from, the brand properties, and the registry of types |
| `src/properties.ts` | `theme.properties` as Java reads it back — the escaping, and why `é` is `é` |
| `src/login/index.ts` | The login type: the hook map, the icon sizes, and the assembled stylesheet |
| `src/login/css.ts` | This page's own rules. Every colour is a `var(--mp-…)`, and the suite asserts it |
| `src/login/template.ftl` | The shell. Holds no copy of the brand: it reads `${properties.brandName!}` |
| `src/email/index.ts` | The email type: `parent=base`, the brand, the inline styles, and the one message bundle |
| `src/email/copy.ts` | Every word this product sends by mail, and the two `MessageFormat` traps under them |
| `src/email/styles.ts` | The same rules as the sign-in card, as inline declarations. Every value is `@mprelist/ui`'s, and the suite asserts it |
| `src/email/html/template.ftl` | The shell. Holds no colour, no size and no name: it reads them all as theme properties |
| `scripts/build.mjs` | Emits the theme. Bundles `src/theme.ts` with esbuild, because the design system is TypeScript source and Node cannot import it |

## Two things that will bite

**The build empties `theme/` and never replaces it.** Both compose files bind-mount that directory into a
running Keycloak and a bind mount follows the inode, so deleting it leaves the container reading the
directory that used to be there. Keycloak then logs `Failed to find LOGIN theme mprelist` and quietly serves
its built-in one. `scripts/build.test.ts` pins the rule.

**A Keycloak upgrade is three checks here, and all three are re-runs rather than rereads.** Both types style
or override templates that stay Keycloak's, so a release can move the ground under either. `src/login/theme.test.ts`
carries the `kc…Class` hook list and `src/email/copy.test.ts` carries the message keys the provider looks up
and the markup its sanitizer allows — each with the date and the command that produced it. A renamed hook
leaves an element unstyled; a renamed message key is worse, because Keycloak then finds the parent theme's
value and the mail goes out in Keycloak's own words, looking exactly as intended.

```bash
unzip -p /opt/keycloak/lib/lib/main/org.keycloak.keycloak-themes-<version>.jar \
  | grep -o 'properties\.kc[A-Za-z-]*'
```

And the mount shadows `/opt/keycloak/themes`, which holds nothing but a README on 26.7 because the built-in
themes are inside a jar. Confirm that is still true before bumping the tag, or a mount that hid nothing
starts hiding something.
