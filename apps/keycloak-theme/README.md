# `@mprelist/keycloak-theme`

The Keycloak theme this product's own Keycloak pages are drawn in — today that is the sign-in flow, the page
`launchWebAuthFlow` opens and the first screen a user ever sees. T80, and
[ADR-0033](../../docs/adr/0033-the-login-page-is-ours-and-is-generated.md) carries the argument.

```bash
npm run build -w @mprelist/keycloak-theme   # → theme/mprelist/login/
npm test -w @mprelist/keycloak-theme
```

## What this workspace is

A **build**, not an app. Nothing here runs: `npm run build` writes a directory that Keycloak reads as a
theme, and the only pages it produces are ones a Java process renders.

```
theme/mprelist/login/
  theme.properties          parent=base, the brand's four values, and every kc…Class hook
  template.ftl              the one template this type replaces
  resources/css/login.css   the token sheet + the component sheet + this page's rules
  resources/img/*.png       the mark at the sizes template.ftl asks for
```

**Every byte of it is derived** from `brand.json` and `@mprelist/ui`, so renaming the product or redrawing
the mark stays the one-file edit T48 made it.

**And it is committed — the one committed build output in this repository.** That is not an exception to the
no-copies rule; it is what the rule actually says. A copy is a problem because it can *disagree* with what it
was copied from, and CI reruns this build and fails on any difference (`git diff --exit-code`), so this
directory is a cache of those two files rather than a second spelling of them. The build is byte-reproducible,
PNGs included. **Run it after editing anything here and commit what it writes.**

It is committed because a deployed Keycloak reads it out of the host's git checkout, beside the Caddyfile and
the production realm, and that host has no Node and compiles nothing ([ADR-0023](../../docs/adr/0023-ci-builds-the-images-and-the-host-pulls.md)).
Both compose files bind-mount this same directory at `/opt/keycloak/themes`, so there is no Keycloak image of
ours and only one delivery to reason about.

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

1. `src/<type>/index.ts`, exporting a `ThemeType`: its `theme.properties` entries, its resources, its icons.
2. Its `.ftl` files beside it in `src/<type>/`. The directory is named for Keycloak's own spelling of the
   type, because that name is both what the build emits and what the realm setting selects.
3. One entry in `TYPES` in `src/theme.ts`.

`scripts/build.mjs` changes not at all — it decides nothing, and walks whatever the registry holds. The realm
then names it (`emailTheme`, `accountTheme`, …) the way `loginTheme` names this one.

**`email` is the one that is coming.** The realm allows password reset and has an SMTP server, so that mail
goes out today in Keycloak's own English template carrying the realm's label — the same three faults on the
page after the login page that T80 fixed on the login page.

## The files

| | |
|---|---|
| `src/theme.ts` | The theme's name, the artwork it draws from, the brand properties, and the registry of types |
| `src/properties.ts` | `theme.properties` as Java reads it back — the escaping, and why `é` is `é` |
| `src/login/index.ts` | The login type: the hook map, the icon sizes, and the assembled stylesheet |
| `src/login/css.ts` | This page's own rules. Every colour is a `var(--mp-…)`, and the suite asserts it |
| `src/login/template.ftl` | The shell. Holds no copy of the brand: it reads `${properties.brandName!}` |
| `scripts/build.mjs` | Emits the theme. Bundles `src/theme.ts` with esbuild, because the design system is TypeScript source and Node cannot import it |

## Two things that will bite

**The build empties `theme/` and never replaces it.** Both compose files bind-mount that directory into a
running Keycloak and a bind mount follows the inode, so deleting it leaves the container reading the
directory that used to be there. Keycloak then logs `Failed to find LOGIN theme mprelist` and quietly serves
its built-in one. `scripts/build.test.ts` pins the rule.

**A Keycloak upgrade is two checks here.** This theme styles `base`'s templates, so a release that renames a
`kc…Class` hook or restructures a form leaves an element unstyled rather than broken.
`src/login/theme.test.ts` carries the hook list with the date and the command that produced it, so the check
is a re-run rather than a reread:

```bash
unzip -p /opt/keycloak/lib/lib/main/org.keycloak.keycloak-themes-<version>.jar \
  | grep -o 'properties\.kc[A-Za-z-]*'
```

And the mount shadows `/opt/keycloak/themes`, which holds nothing but a README on 26.7 because the built-in
themes are inside a jar. Confirm that is still true before bumping the tag, or a mount that hid nothing
starts hiding something.
