# ADR-0017: One web app with loginless public routes; subscribing starts in the popup

**Status:** Accepted (2026-08-20)
**Scope:** Full app. Amends ADR-0011's reservation of `apps/dashboard`, and settles what T33–T36 were for.

## Context
ADR-0011 reserved `apps/dashboard` for a React SPA — "the customer dashboard" — and the backlog gave it a
Keycloak login (T33), a plans page (T34), an account page (T35) and legal pages (T36). ADR-0007's gating
table, meanwhile, puts the conversion moment in the popup: the ad list is deliberately **not** subscription
gated, because "a locked button beside the user's own ads is the strongest conversion surface available".

Those two things pull in opposite directions. A plans page on a website means the user leaves the popup,
signs in a **second time** on a different origin, and finds a plans page — three steps away from the locked
button that motivated them.

But a hosted surface is not optional once real money is involved, for three reasons that have nothing to do
with taste:

1. **A Chrome popup is dismissed the moment focus leaves it.** Once Checkout opens in a tab there is no
   popup to return to, so the redirect has to land somewhere.
2. **The Chrome Web Store listing requires a hosted privacy policy URL** — which is what T36 always was.
3. **Stripe's Customer Portal is a hosted redirect by construction.** Changing a card or cancelling is a web
   flow whatever we build.

The reference product (dotb, ADR glossary) puts subscription management on its website dashboard. That is
evidence for a website, not evidence for putting the *plan choice* there.

Options weighed: build T33–T36 as specced (a customer SPA with its own login); a loginless static site with
plans in the popup; or no site at all beyond legal pages hosted anywhere.

## Decision
**One workspace, `apps/web`. One build. Public routes need no login; `/admin/*` does.**

```
apps/web/
  src/
    public/    success · cancel · privacy · terms      — no auth code reached
    admin/     tier management                          — Keycloak PKCE + ADMIN role
```

- **The popup owns the plan choice.** It already holds a valid access token after PKCE sign-in, so it renders
  the plan cards from `GET /api/plans`, calls the Checkout endpoint itself, and opens the returned Stripe URL
  in a tab. **One login for the whole product**, and the upgrade button sits next to the locked ad.
- **The public routes never learn who anybody is.** The success page says the payment landed and to reopen
  the extension; the Stripe webhook does the actual work of moving the subscription. There is nothing on
  those pages worth authenticating for.
- **The admin routes are the only authenticated part**, and they arrive after the customer loop works
  (slice D, ADR-0016). They reuse the `mprelist-dashboard` Keycloak client, which the realm has defined
  since #15.
- **Subdomains are deployment, not architecture.** `www.` serves `/`, `admin.` serves `/admin`, from one
  build. Locally both are one origin and one Vite dev server.
- **T33/T34/T35 dissolve.** T33's login becomes the admin route guard; T34's plans page moved into the
  popup; T35's account page is the popup's quota display plus a Customer Portal link. T36 survives as the
  legal pages, unchanged in purpose.

`apps/dashboard` is renamed `apps/web`, because it is no longer a dashboard: it is a public surface with an
admin corner, and no customer ever has an account page on it.

## Consequences
- **Positive:** One sign-in. The user authenticates once, in the extension, and never again — the thing they
  bought is in the extension, so that is where the account lives.
- **Positive:** The conversion path is one click from the locked button, which is what ADR-0007 designed the
  ungated ad list to enable.
- **Positive:** The public bundle can be tiny and the pages are cacheable statics — a Web Store reviewer and
  a post-Checkout redirect both get a page, not an app booting an OIDC client.
- **Negative:** The public bundle carries the admin route code and the auth library, since it is one build.
  No privilege leak — the API guards on the `ADMIN` role server-side — but the endpoint shapes are readable
  by anyone who opens the bundle, and the bundle is larger than the public pages need. Splitting into two
  Vite entry points is a cheap later move if either matters.
- **Negative:** A user who has uninstalled the extension has no way to cancel except the Stripe emails and
  the Portal link in them. Acceptable while the extension is the product; the moment there is anything to
  manage without it, `apps/web` grows a customer login.
- **Consequence for Go-Live:** every origin the app is served from has to be in the `mprelist-dashboard`
  client's `redirectUris` and `webOrigins`. The realm imports on **first start only**, so adding one to a
  running stack means `down -v` — the production realm has to name its origins before it is first started.

## Revisit if
Customers need to manage anything without the extension installed — a team plan, invoices, multiple
Marktplaats accounts (#47) — at which point `apps/web` gains a customer login and T35's account page comes
back on its own merits rather than as the default shape.

---

## Refined 2026-09-02 (ADR-0023) — "`admin.` serves `/admin`" is work in the proxy, not in the bundle

The consequence above reads as a description of something the build does. It is not, and cannot be:
`apps/web/src/main.tsx` chooses its surface on `isAdminPath(location.pathname)` and knows nothing about the
host — deliberately, because one image has to run anywhere. Left alone, `admin.<domain>/` renders the *public*
site and `www.<domain>/admin` renders the admin corner, and nothing prevents either.

[ADR-0023](0023-ci-builds-the-images-and-the-host-pulls.md) is where the split is actually made: Caddy
**redirects** `/` to `/admin` on that hostname, **carrying the query**, so that a sign-in returning to
`admin.<domain>/?code=…` is still recognised by `returningFromSignIn` — which is what T54 built the
query-based arrival for, and which is why the realm registers the origin root rather than a path beneath it.

> **Corrected 2026-09-02, in T56**, along with ADR-0023's own paragraph: this said *rewrite*, and it has to be
> a redirect. A rewrite is internal to the proxy and never reaches the address bar — and `location.pathname`
> is precisely what the sentence above says the choice is made on. nginx answers every path with the same
> `index.html` regardless, so the rewrite would have changed nothing while looking exactly like it had.

The Go-Live consequence above is unchanged and is the reason this matters: both site origins have to be in
the `mprelist-dashboard` client. The realm's *import* is first-start-only, but its *contents* stay editable
in the admin console — see `infra/README.md` § Deploying, where that distinction is now stated rather than
implied.

## Amended 2026-09-25 (T58) — the site shows the plans, and still sells nothing

The Web Store listing's Homepage URL is the site's root, and the landing page there shows the plan cards a
visitor would be choosing between. So `GET /api/plans` **answers without a token**: it is the one read the
API opens, because nothing in it is per-user, and the popup still sends its token and gets the same answer.

What this decision said stays true. **The popup still owns the plan choice** — the landing page's cards have
no button, and Checkout is still opened only from the popup, which knows who is buying. **The public pages
still never learn who anybody is**: the one call they make is `apps/web/src/public/plans-on-offer.ts`, with
credentials omitted and no headers, and `no-identity.test.ts` holds that file to exactly that. How a plan is
worded moved to `@mprelist/contracts` (ADR-0011, amended the same day), so the two surfaces cannot price one
plan two ways.

