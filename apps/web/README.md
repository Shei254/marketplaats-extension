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
  public/         success · cancel · not-found            — no auth code reached
  admin/          tier management                          — Keycloak PKCE + ADMIN role, T54 (#85)
```

```bash
npm run dev -w @mprelist/web        # http://localhost:5173 — /success and /cancel
npm test -w @mprelist/web
npm run build -w @mprelist/web      # dist/
npm run preview -w @mprelist/web    # dist/, served the way a host would
```

## What is here after T50 (#81)

| Path | |
|---|---|
| `/success` | Stripe's `success_url`. The payment landed; open the extension. |
| `/cancel` | Stripe's `cancel_url`. Nothing was charged and nothing changed. |
| anything else, `/` included | "There's nothing at this address", pointing back at the toolbar |

**`/` is deliberately the fallback.** There is no landing page on the design canvas, and inventing one is a
decision for the ticket that also writes the Web Store listing (T58, #89) and settles the name (T60, #91).

**Privacy and terms are T36 (#45)**, and until they exist nothing links to them — the canvas draws those
links in the header and the footer, and a link to an address this site answers with "there's nothing here" is
worse than a link that arrives with its page. Adding them is a route-table entry, a page, and the two links.

## Three things worth knowing

**The public routes never learn who anybody is**, and that is the decision rather than an omission. Stripe
redirects a browser here the moment a payment lands; the webhook (T20, #30) is what moves the subscription,
so there is nothing on these pages worth authenticating for and no question to ask the API.
`src/public/no-identity.test.ts` holds the whole directory to it — no `fetch`, no storage, no cookie —
walking by directory so that `src/admin/`, the one authenticated corner, is the named exception rather than
a hole.

**One build, one `index.html`, which is a deploy-time obligation.** Every public path is answered by the
same file and the router runs in the browser, so a host that returns 404 for `/success` breaks the flow
slice C exists to prove — and it breaks it *after* the money has moved. `vite dev` and `vite preview` both
fall back already; T55 (#86) has to say so to whatever serves `dist/`.

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

[`packages/contracts`](../../packages/contracts/README.md) is not consumed yet. It arrives with `/admin`
(T54, #85), which is the first thing here that talks to the API at all.
