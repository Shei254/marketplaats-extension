# `apps/web` — the public site, with an admin corner

Empty on purpose. This directory is the home [ADR-0011](../../docs/adr/0011-repository-layout.md) reserved
for a React SPA, renamed and repurposed by
[ADR-0017](../../docs/adr/0017-web-surface-and-subscribing.md). The code arrives with **T50**.

It is **not** a customer dashboard. Customers never have an account here — the plan cards and the Checkout
hand-off live in the extension popup, which already holds an access token, so the product has **one sign-in**
and it happens in the extension.

```
src/
  public/    success · cancel · privacy · terms     — no auth code reached
  admin/     tier management                        — Keycloak PKCE + ADMIN role, T54
```

- **The public routes never learn who anybody is.** Stripe's `success_url` lands here and the page says the
  payment arrived and to reopen the extension; the webhook (T20) does the actual work. Privacy and terms
  (T36) are here because the Chrome Web Store listing needs a hosted privacy policy URL.
- **`/admin` is the only authenticated part**, and it arrives after the customer loop works — slice D of
  [`backlog.md`](../../docs/backlog.md). It reuses the `mprelist-dashboard` Keycloak client the realm has
  defined since #15.
- **One workspace, one build.** The `www.` / `admin.` split is DNS at deploy time (T56), not a build
  concern. Locally both are one origin on one Vite dev server.

It consumes `packages/ui` (so the site and the popup share one look) and `packages/contracts` (so the API
contract is typed once for both clients).

When it gains a `package.json` it becomes an npm workspace automatically
([root README](../../README.md#working-on-it)).
