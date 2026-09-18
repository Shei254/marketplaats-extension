# ADR-0033: The login page is a surface of ours, and it is generated rather than written

**Status:** Accepted (2026-09-19)
**Scope:** [`apps/keycloak-theme`](../../apps/keycloak-theme), the `loginTheme` both realm exports now name,
the theme mount in [`infra/docker-compose.yml`](../../infra/docker-compose.yml) and
[`infra/docker-compose.prod.yml`](../../infra/docker-compose.prod.yml), and one step in
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
**Refines [ADR-0021](0021-design-system-stays-ours.md)**, which said the design system is ours and is a CSS
string, and is now asked whether that holds on a page this repository does not render.
**Refines [ADR-0011](0011-repository-layout.md)** with a fourth workspace that is not a deployable, and
**[ADR-0005](0005-identity-and-auth.md)**, which chose Keycloak and never said what its pages look like.
T80 is the work.

**The decision is that the sign-in page is one of this product's screens rather than Keycloak's**, that it is
**generated** from `brand.json` and `@mprelist/ui` like every other derivative of those two, that it is
**Keycloak's templates in our clothes** rather than our templates doing Keycloak's job, and that the
generated directory is **committed and mounted** rather than delivered as an image of ours.

## Context

Until now the first page a user of this product ever saw was Keycloak's. `launchWebAuthFlow` opens the realm's
login page in a window Chrome owns ([ADR-0010](0010-extension-authentication.md)), and what appeared there was
the stock theme: a different typeface, a different blue, no mark, and — because the base template renders
`realm.displayName` — the words **"Marktplaats Relist (development)"** on the local stack and **"Bumpr"** on
the production export.

Both of those are wrong in ways that are not cosmetic:

- **The name leads with "Marktplaats."** `brand.json` states the rule in its own `$note`, and it is a Web
  Store policy rather than a preference: a name implying endorsement by a trademark holder is a rejection.
  T48 removed that name from the manifest, the popup and the site, and left it on the one page between a user
  and their account.
- **"Bumpr" is stale.** `brand.json` says `AdBump`; the production realm was exported when it said something
  else. That is precisely the drift T48 exists to prevent, and it survived because the realm file is the one
  place the brand was copied to by hand.
- **The page is in English.** `popup.html` and `apps/web/index.html` are both `lang="nl"`, so signing in was
  the one step of the product that changed language.

The narrow question — "brand the login page" — therefore had a wider one under it: **who owns that screen.**
And once the answer was "we do", a second question followed that the first pass got wrong twice before
getting right: **how 84 KB of generated static files reaches a server.**

## Options weighed

### Whose page it is

**1. Leave it, and fix only the name.** Set the realm's `displayName` from an environment variable and stop.
Cheapest, and it keeps the copy of the brand that is the problem — now in `.env.example` instead of a realm
file. It also leaves the page looking like a different product than the one that opened it, which on an OAuth
window that a user did not navigate to themselves is the shape a phishing page has.

**2. A theme with hand-written CSS.** The ordinary way to theme Keycloak. It puts a second copy of the
palette in the tree — `tokens.ts` says in its first line that it is *"the only place in this repository a
colour is written down"* — plus a committed PNG of the mark, which T48 spent a ticket removing. Two copies
that nothing holds together, and the first symptom is a button that is the wrong blue on one screen.

**3. Our own templates, inheriting `base`.** Write `login.ftl`, `register.ftl`, the reset chain and the error
pages. Total control, and it forks the authentication screens of a product we upgrade: every Keycloak release
becomes a diff to re-apply, on the flow where being subtly wrong is a security bug rather than a visual one.

**4. Generated theme, Keycloak's templates, our classes.** What was chosen.

### How it reaches a server

**5. A third image.** `ghcr.io/<owner>/<repo>/keycloak` — the stock server with the theme copied in, built,
pushed, retagged and pruned beside the other two. It works, and it was built and walked before being dropped.
Its price is that Keycloak's version is then written in two files that must not drift, that a package joins
the registry and the prune list, that `DeployedStackTest` stops being able to say the deployed Keycloak is the
one the suite ran against, and that a 84 KB directory of CSS and PNGs is delivered by the machinery built for
a JVM that compiles this repository inside itself.

**6. A theme jar, downloaded by the deploy script.** The shape Keycloak documents for distributing a theme.
Two things kill it. A jar goes in `providers/` and needs `bin/kc.sh build` after it lands, so the cheap
delivery costs an augmentation step on a 1 vCPU host at every start — the directory form under `themes/`
needs none. And the repository is private, so fetching a release asset means a repository read key on the
production machine: exactly the second credential [ADR-0023](0023-ci-builds-the-images-and-the-host-pulls.md)
refuses and `infra/deploy/mprelist-deploy` says in as many words that it refuses.

**7. A theme-only image, mounted in with a `type: image` volume.** Keeps Keycloak's version in one place and
ships with the tag, at the cost of a GHCR package, its prune and retag entries, and a compose mechanism most
readers of that file would have to look up.

**8. Committed, and bind-mounted out of the checkout the host already has.** What was chosen.

## Decision

**`apps/keycloak-theme` is a workspace whose build output is a Keycloak theme**, and everything it produces
is derived from `brand.json` and `@mprelist/ui`, so redrawing the artwork or renaming the product stays the
one-file edit T48 made it.

**`parent=base`, and exactly one template is replaced.** Keycloak's `base` theme carries the flow with no
styling of its own: the sign-in form, registration, the reset chain, the error and info pages. Every control
in them is written `class="${properties.kcInputClass!}"`, so a theme decides what those classes *are*. Ours
points them at the design system's own — `mp-input`, `mp-btn mp-btn--primary`, `mp-field`, `mp-note` — which
means **the button on the login page is the button `componentCss` draws**, not one built to look like it. A
change to the sheet reaches this surface the way it reaches the popup.

The one replaced template is `template.ftl`, the shell: the card, the mark, the brand name, the footer. It is
layout, and the two things in it that are not are both about not lying to the reader — the heading is
`brand.json`'s name rather than the realm's label, and the `<title>` is built from the page's own heading
rather than from Keycloak's, which carries that label into the tab.

**The workspace is shaped for theme *types*, not for the login page.** A Keycloak theme is
`themes/<name>/<type>/` and the types are independent: each has its own properties, resources and templates.
So `src/theme.ts` holds a registry, a type is a directory under `src/` named for Keycloak's own spelling of
it, and `scripts/build.mjs` walks them and decides nothing. **Adding a type is a directory and a line**,
rather than a second workspace repeating the esbuild step, the `.properties` escaping and the icon resizing.
Only `login` exists today. `email` is the one that is coming — the realm allows password reset and has an
SMTP server, so that mail goes out in Keycloak's own English template — and the account and admin consoles
are not surfaces of this product and keep Keycloak's own.

**The brand crosses as theme properties, not as template substitution.** `${properties.brandName!}` reads a
value the build wrote, so the committed `.ftl` holds no copy of the name and this workspace needs no third
implementation of the `{{brand.…}}` resolver that `scripts/brand.mjs` and `apps/web/src/brand.ts` each have.

**The mark is the raster, not the vector.** The other four surfaces draw `Icon name="logo"` in a `.mp-mark`
tile; there is no React here to render it, and inlining its geometry would be the copy `packages/ui` exists
to prevent. The objection to a raster elsewhere was that it cannot follow a theme — and `BRAND_MARK` is the
one part of the palette that is deliberately *the same in both themes*, so here that costs nothing.

**The realm asks for it by name, in both exports.** A login theme is a property of a realm in Keycloak's own
model, and the realm file is *"the only description of the realm there is"*. The cost is the one that file
always has: it imports on first start only, so this is a `down -v` on a stack that already exists.

**Dutch, with one supported locale.** `supportedLocales: ["nl"]` and `defaultLocale: "nl"`, which is what the
rest of the product is. Keycloak's own `messages_nl.properties` is what makes it free; with one locale the
switcher does not render.

### The output is committed, and that is one delivery rather than two

**`apps/keycloak-theme/theme/` is in git, and both compose files bind-mount it at `/opt/keycloak/themes`.**
The deployed host is not only a puller of images: `git clone <this repository> /opt/mprelist` is step one of
its setup, and `infra/docker-compose.prod.yml` already bind-mounts `./caddy/Caddyfile` and
`./postgres/init-production` straight out of that checkout. A theme is that kind of thing — static files a
server reads — and not the kind of thing ADR-0023's registry was built for.

So there is **no third image**: ADR-0023 still builds two, `DeployedStackTest` still holds both Keycloak tags
equal across the two compose files, the prune list is unchanged, and the local stack and the deployed one run
the same stock server with the same directory mounted the same way. The awkwardness the first pass accepted —
one theme, two delivery mechanisms, Keycloak's version written twice — is not mitigated here, it is absent.

**This makes it the one committed build output in the repository, and the rule it appears to break is
sharpened rather than excepted.** `brand.json` says no derivative of the artwork is committed; what that rule
is *for* is that a copy can disagree with the thing it was copied from. An output CI regenerates and compares
byte for byte cannot. **So the test is drift, not whether a file is in git** — and a committed, gated
derivative passes it while a hand-written stylesheet still fails, because nothing could hold that one to
`brand.json` at all. `ci.yml` runs `npm run build` and then `git diff --exit-code` on that directory; the
build is byte-reproducible, PNGs included, so this is equality and not a heuristic.

**Mounted over `/opt/keycloak/themes` rather than beside it.** That directory holds nothing but a README on
26.7 — the built-in themes are inside a jar — so shadowing it hides nothing, and it means the theme's name is
`THEME_NAME`'s alone rather than half in the build and half in a mount path. The alternative,
`KC_SPI_THEME_FOLDER_DIR` pointing at a directory of ours, is more robust against a release that ever puts a
real file there, and was not worth an env var in two files for a risk a checklist covers.

## Consequences

- **`down -v` on every existing local stack**, once, because the realm changed. infra/README.md § Resetting
  already names editing `keycloak/` as a change with that cost.
- **A theme change is subject to the `git pull` rule, and it is the first one that is silent.** The deploy
  script deliberately does not update the checkout — that would be the repository credential ADR-0023 keeps
  off the host — so `infra/README.md` § Deploying already says a release touching `infra/` needs a pull
  first, and "nothing enforces it". The realm is inert after first start and a stale Caddyfile fails loudly;
  a stale theme *renders*, in the old colours, with no error anywhere. **Documented, not enforced**, which is
  the same treatment the other two get and is a deliberate refusal to add machinery in a pass that exists to
  remove it. Stamping `org.opencontainers.image.revision` on the images and refusing a deploy whose checkout
  does not match was costed and rejected here.
- **A missing build is a stopped stack rather than a stock page** — but for a different reason than before.
  The directory is committed, so a clone has it; the way to lose it is to delete it, and the build empties it
  rather than replacing it precisely because a bind mount follows the inode.
- **Keycloak upgrades now have a step**, and it is two things rather than one. `base`'s templates are what
  this theme styles, so a release that renames a `kc…Class` hook or restructures a form leaves an element
  unstyled; `src/login/theme.test.ts` carries the hook list, dated and with the command that produced it, so
  the check is a re-run rather than a reread. And because the mount shadows `/opt/keycloak/themes`, an
  upgrade is also where somebody confirms that directory still holds nothing but a README.
- **Only `login` is themed.** The account console and the admin console keep Keycloak's own. Neither is a
  surface of this product: the admin console is for whoever operates the realm, and nothing links a customer
  to the account console.
- **What is still Keycloak's is still Keycloak's** — every validation, every error, every message string, the
  brute-force lockout and the password policy. This ADR changes what the page looks like and nothing about
  what it does.

## Revisit if

A second brand or a tenant needs its own login page, at which point the theme name stops being a constant and
the registry gains a dimension — or the checkout stops being how the host gets its configuration, at which
point the delivery argument above loses its premise and the theme-only image (option 7) is where to start.
