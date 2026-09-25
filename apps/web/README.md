# `apps/web` — the public site, with an admin corner

React + Vite, one build, one `index.html`. It is **not** a customer dashboard: customers never have an
account here — the plan cards and the Checkout hand-off live in the extension popup, which already holds an
access token, so the product has **one sign-in** and it happens in the extension
([ADR-0017](../../docs/adr/0017-web-surface-and-subscribing.md)).

```
src/
  main.tsx        the only file that touches the document
  routes.ts       path → page, pure                       — the whole route table
  Site.tsx        the frame, and the switch that picks a page
  brand.ts        the root brand.json, and index.html's token substitution
  site-styles.ts  this surface's rules, as a string
  public/         success · cancel · privacy · terms · not-found   — no auth code reached
  admin/          the dashboard                            — Keycloak PKCE + ADMIN role, T54 (#85)
    admin-nav.ts    the pages it has, as a table           — a second page is one row here
    AdminShell.tsx  the sidebar and the frame one page is drawn in
    AdminCatalog.tsx  the tiers page, and the writes behind it
    AdminPrices.tsx   the Stripe prices carrying no tier
```

```bash
npm run dev -w @mprelist/web        # http://localhost:5173 — /success and /cancel
npm test -w @mprelist/web
npm run build -w @mprelist/web      # dist/
npm run preview -w @mprelist/web    # dist/, served the way a host would
```

## What is here

| Path | |
|---|---|
| `/` | The landing page, and the Web Store listing's Homepage URL (T58). **The one page drawn across the whole window** rather than in the card: a hero in the mark's gradient with the install button and an animated demo of a repost, three steps, the plan cards from `GET /api/plans` (asked without a token), and the install button again. Its words are fewer than the listing's and claim nothing the listing does not. |
| `/success` | Stripe's `success_url`. The payment landed; open the extension. |
| `/cancel` | Stripe's `cancel_url`. Nothing was charged and nothing changed. |
| `/privacy` | The privacy policy. **The Chrome Web Store listing (T58, #89) requires this URL**, so once that listing is live the address is published somewhere we do not control. |
| `/terms` | The Gebruiksvoorwaarden, with the warning that relisting deletes the ad first kept near the top where it is read. |
| `/admin` | The dashboard an operator maintains the catalog from. **The only authenticated thing in this build** (T54, #85). |
| anything else | "There's nothing at this address", pointing back at the toolbar |

**`/` was the fallback until T58**, which drew `docs/design/Landing.dc.html` alongside the Web Store
listing it is the homepage of, and built it. It was then redesigned in code first — full width, Geist, the
gradient hero, and without the listing's "Goed om te weten", which the Terms and the Privacy page carry —
and the artboard is behind it until it is redrawn from the page.

**This site is set in Geist, self-hosted.** The woff2 comes from `@fontsource-variable/geist` and Vite
bundles it into `assets/`, so the font is one more file from this origin and never a request to a font
CDN. The popup stays on `system-ui`; `src/site-styles.ts` says why.

**The terms are the operator's own Gebruiksvoorwaarden**, handed over as finished copy on 2026-09-22 and
rendered as written — the draft box both pages carried came off with them. What the operator wrote is what
the page says, including three claims this build does not keep: a *gratis proefperiode* (ADR-0006 ships
none), billing *per maand* (T62 sells a tier monthly **and** annually) and cancelling via
*accountinstellingen*, which do not exist — it is the Stripe Customer Portal, reached from **Betaling
beheren** in the popup. That was asked for and decided; `legal.tsx`'s own header records it rather than
leaving the next reader to find it.

**The privacy page is still the canvas's structure**, and every claim on it is one the schema can keep.

## Three things worth knowing

**The public routes never learn who anybody is**, and that is the decision rather than an omission. Stripe
redirects a browser here the moment a payment lands; the webhook (T20, #30) is what moves the subscription,
so there is nothing on these pages worth authenticating for, and nothing to ask the API about anybody.
`src/public/no-identity.test.ts` holds the whole directory to it — no `fetch`, no storage, no cookie —
walking by directory so that `src/admin/`, the one authenticated corner, is the named exception rather than
a hole. The landing page's plan cards (T58) are the one call outside it: `src/public/plans-on-offer.ts`
asks `GET /api/plans` with credentials omitted and no headers, and the same test holds that file to exactly
that — so the page still learns nothing about who is looking at it.

**One build, one `index.html`, which is a deploy-time obligation.** Every public path is answered by the
same file and the router runs in the browser, so a host that returns 404 for `/success` breaks the flow
slice C exists to prove — and it breaks it *after* the money has moved. `vite dev` and `vite preview` both
fall back already, and since T55 (#86) so does the nginx in [`Dockerfile`](Dockerfile): one `try_files` in
[`nginx.conf.template`](nginx.conf.template), read by `src/admin/deployed-config.test.ts` so that it stays
there.

**Where the API and the realm are is served to this bundle, not built into it** (T55, #86). Every page loads
`/config.js` before the bundle: [`public/config.js`](public/config.js) commits it as an empty object, and the
deployed image answers the same path from its own environment. What the bundle reads is a **patch** over
`src/admin/admin-config.ts` — the shape `GET /api/client-config` already serves the extension
([ADR-0013](../../docs/adr/0013-remote-client-configuration.md)) — so empty means the defaults are correct,
one image runs in every environment, and a wrong address costs a restart instead of a rebuild. The redirect
URI is not in it: it is `location.origin`, which is the one value that cannot disagree with where the browser
will actually come back to.

**No `@vitejs/plugin-react`.** Vite transforms `.tsx` with esbuild and takes the automatic JSX runtime from
this workspace's `tsconfig.json` — the plugin would buy Fast Refresh and a Babel pass, on a site of static
pages with no state to preserve across an edit. The dev server full-reloads instead, and that is the whole
of what is lost.

## What it consumes

[`packages/ui`](../../packages/ui/README.md) — the same tokens and controls the popup is built from, so the
site and the extension are one look rather than two. There is no CSS pipeline here for the same reason there
is none there: the sheet is a string, injected as a `<style>`.

The root [`brand.json`](../../brand.json) — imported rather than copied, so the compiler checks it: a
`brand.json` that lost its `name` fails `npm run typecheck` here. `index.html` is the one file React never
renders, so its `{{ brand … }}` tokens are substituted by a plugin in
[`vite.config.ts`](vite.config.ts), which throws on an unknown key or a token left standing — the same rule
the extension's build follows.

[`packages/contracts`](../../packages/contracts/README.md) — the API's wire types, which arrived with the admin
corner (T54, #85), and since T58 how a plan reads aloud, which the landing page shares with the popup.

## The admin corner

`/admin` is a **surface rather than a page** (ADR-0017): its own frame, its own stylesheet, and the only
authentication in this bundle. `main.tsx` chooses it before the public route table is consulted, which is why
`pageFor("/admin")` still answers `not-found` — every page in that table is public, and a reader can trust it.

**It is a dashboard rather than a screen** (2026-08). A sidebar says where you are, what else there is, who
you are signed in as and how to leave — sticky the full height, because the catalog is the one thing here that
grows without limit, and a strip across the top under 900px, which needs no toggle and so has no state to
leave in the wrong position. The pages themselves are a table in `admin-nav.ts`: a row is a word in the
sidebar, a heading and the sentence under it, so a page is a body and nothing else and cannot spell its own
chrome differently. It is **not** a router — the realm registers the origin root as this client's one redirect
URI, so a path under `/admin` is a URL a sign-in could not come back to, and which page is showing is state in
the surface rather than an address.

**The Stripe prices nobody tagged are a page, not a footer.** They used to sit under the tier table, which put
a list nobody can act on beneath the list an operator works in. The sidebar carries a count when there is
something in it, which is the one moment it is worth anybody's attention.

**Arriving is the request to sign in.** There is no button: `/admin` signed out goes straight to Keycloak,
Authorization Code + PKCE against the `mprelist-dashboard` client the realm has defined since #15 and which
nothing had used until now.

**The redirect lands on `/`, not on `/admin`, and that is a constraint rather than a choice.** The realm
registers exactly `http://localhost:5173/` and Keycloak matches redirect URIs exactly — `KeycloakRealmTest`
proves a path beneath it is refused with a page rather than a bounce — and the realm imports on first start
only, so wanting `/admin` back would be a `down -v` on every stack that already exists. An arrival is
recognised by the `code` in the query rather than by the path, and the address bar is rewritten afterwards. It
is also the shape Go-Live wants: T56 (#87) serves `/admin` from `admin.<domain>`, whose root is exactly this.

**The access token lives in memory and nowhere else.** Not `localStorage`, not a cookie, not `sessionStorage`.
A reload signs in again, which while Keycloak's own SSO session is alive is a redirect nobody sees — and two
things are bought that matter more than the round trip: a bearer token that opens the tier catalog is never at
rest where any script on this origin can read it, and signing out of Keycloak signs you out here. There is no
refresh token for the same reason; an expired token is a `401` from our own API and the answer to that is one
redirect. What *does* survive the redirect is three strings in `sessionStorage` — the PKCE verifier, the
`state` and where the operator was going — cleared the moment the code is exchanged.

**The `ADMIN` role decides a screen and never a permission.** The API enforces it on every route under
`/api/admin` (#27), server side, before routing. What the check here buys is that somebody signed in as the
wrong person is *told* so rather than shown an empty catalog and a row of `403`s — and that they are offered
the one thing that helps, which is signing in as somebody else. Without that button, slice D's step 2 is a
trap with no way out.

**What the screen will not offer**: typing a Stripe Price id, or editing an amount — the amount is Stripe's
and immutable, and repricing is a new tagged Price the sync repoints the tier onto (ADR-0019). `isDefault` is
a **move, never a toggle** — the API offers no request that *clears* the flag, so there is no control here
that could ask for one.

**A tier can be deleted here** (T77,
[ADR-0032](../../docs/adr/0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md)), and **every**
tier can — the default and the last included. This sentence used to rule it out, on the grounds that a tier is
retired by unpublishing it since a subscription references its tier behind a foreign key, which was a foreign
key speaking rather than anything an operator would recognise. The confirmation quantifies what is about to
happen — how many subscribers move and where, how many live Stripe subscriptions get cancelled — and asks for
the tier's name to be typed **only** when real payers will be cancelled, so undoing a plan created a minute
ago stays one click.

**A plan can be created here** (T61, #127), which amends ADR-0019 in the direction that ADR's own *Revisit
if* pointed. The form creates the Stripe Product and Price and then the tier, in one submit — and says on its
face that the amount is written once, because Stripe Prices are immutable and changing one means creating
another. The currency is **shown, not chosen**: every tier is priced in what the Stripe account settles in, because a
plan screen is a comparison and two currencies on it is not one. Where Stripe cannot say, the form creates
nothing rather than guessing.

**A plan may be sold at more than one rhythm** (T62, #128). Each row lists every Stripe Price it is sold at,
and **Prices** adds one — or replaces one it already has, which is the only way to reprice, since Stripe
Prices cannot be edited. The form says which of the two is about to happen and, when it is a replacement, that
everybody already subscribed keeps the price they signed up at.

**The feature flags are a number and a hatch** (T69, [ADR-0026](../../docs/adr/0026-a-feature-flag-is-a-field-spelled-once.md)).
A JSON textarea was honest rather than lazy when it was written: `features` is an open object, every tier
carried `{}`, and no flag had an implementation behind it, so checkboxes would have been inventing a schema
this product had not decided on. **T68 decided one.** So the bulk cap is now set with the same gesture as the
quota beside it — `Bulk repost, at a time`, empty for a tier that does not include it, and **0 refused**,
because `{"upTo": 0}` is not "no bulk" but *bulk capped by the quota alone*. Turning it off writes
`{"bulk": false}` and never a deleted key, which is what keeps `V8__seed_bulk_entitlement.sql`'s claim about
the admin edit true on a machine that restores a dump.

**`Advanced · edit as JSON` keeps every other shape reachable**, as a mode and not a mirror: exactly one
control owns the value at a time, so opening the hatch disables the number and closing it parses back. One
invariant covers the rest — the number owns the value only when it can represent the whole truth — which is
why the form opens on the hatch for a tier storing something the field cannot say, and says why it will not
close while that is still true. The flag itself is spelled once, in `packages/contracts/src/features.ts`, and
read from there by the popup too.
