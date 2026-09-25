# ADR-0036: The site sells, and a subscriber switches plan in place rather than buying a second one

**Status:** Accepted (2026-09-25)
**Scope:** `apps/web`'s public surface — the landing page's plan cards, a customer sign-in, the success and
cancel pages, and the site's response headers; and a new **Plan switch** route beside `POST /api/checkout`.
T85 is the work. It builds on T83, which already refuses a second Checkout, and on T84, whose landing page it
gives buttons.
**Supersedes part of [ADR-0017](0017-web-surface-and-subscribing.md)** — "the popup owns the plan choice" and
"the public routes never learn who anybody is", both restated by its T58 amendment the same morning this
reversed them. What 0017 said about the admin corner, the subdomains and the one build is untouched.
**Refines [ADR-0019](0019-plans-are-stripe-first-and-webhook-synced.md) and
[ADR-0031](0031-the-free-tier-is-the-one-without-a-price.md)**: the free tier is still never a Plan, and is
answered beside the plans rather than among them.

**The decision is that a visitor can buy from `/`**, signed in against the same Keycloak client the admin
corner uses; that **a subscriber changing plan is a Plan switch** — the Price on the Stripe subscription they
already hold, changed in place — and never a second Checkout; and that the popup keeps T83's answer to a
paying subscriber, the Customer Portal, rather than gaining the switch.

## Context

The landing page shipped with plan cards and no buttons, on 0017's argument that only the popup knows who is
buying. Asked for buttons, the cheap answer was a link to the Web Store. It was declined: the site should be
a place a customer can subscribe from, sign in to and come back to, not a brochure for the extension.

Working out what a button does for somebody who **already pays** turned up the fact this ADR is mostly
about. `POST /api/checkout` always opens a Checkout in `Mode.SUBSCRIPTION`, which creates a **new** Stripe
subscription; nothing in the codebase changes an existing one. And there is one `subscription` row per user,
which `SubscriptionRows.theRowBehind` finds by **account or customer**, never by which Stripe subscription an
event is about. So a Pro subscriber who buys Onbeperkt holds two live subscriptions, both billed, mirrored
into one row by whichever event came last — and when they cancel the old Pro to stop paying twice, its
`subscription.deleted` runs `ended()` against that same row and drops them to the default tier while
Onbeperkt is still charging. "Checkout, then cancel the old one" is the same failure with a race in front of
it. T83 closes that door — `POST /api/checkout` answers `409 ALREADY_PAYING` — and sends the popup's
subscriber to the Portal; this ADR decides what the site offers them instead.

## Decision

- **A real customer sign-in on the site.** Authorization Code + PKCE against `mprelist-dashboard`, reusing
  the admin corner's flow. The token lives in memory only, as `admin-session.ts` argues. A reload stays
  signed in through a `localStorage` **flag that carries no secret**: set on sign-in, cleared on sign-out,
  and on load it triggers one `prompt=none` round trip — `login_required` clears it and draws the page
  signed out. A stranger has no flag and is never redirected.
- **One card, a `current` flag.** Signed out nobody is current. Signed in on the free tier or on no tier,
  a paid card's button is Checkout. A subscriber sees "Huidig" on theirs and **Overstappen** on the rest.
- **A Plan switch is immediate and prorated both ways**, `pending_if_incomplete` so nothing moves until the
  money has, confirmed in a dialog that shows **Stripe's invoice preview** rather than an amount we worked
  out. A charge that needs 3-D Secure goes to the invoice's hosted page. Downgrades leave a credit on the
  Stripe customer; scheduling them for period end was the kinder option and was deferred as the costlier one.
- **Moving to the free tier is cancelling**, not a switch — there is no Price to switch to — and goes to the
  Customer Portal, whose cancel-at-period-end and ADR-0018's fallback already do it right.
- **A choice made signed out survives the sign-in** in `sessionStorage`, and carries on to Checkout only
  when it is still a purchase. It never becomes a Plan switch by itself: that charges a saved card, and
  signing in is not consent to it.
- **The free card is the Free tier on offer** (glossary), which T84 adds to `GET /api/plans` beside `plans`
  and not in it, so a Plan still always has a price. No free card when it is absent.
- **`frame-ancestors 'none'` and a tight CSP on the site.** A signed-in page with a button that charges a
  card is a clickjacking target, and the site sent no such header before.

## Considered options

- **Links to the Web Store; the popup still sells.** Kept 0017 whole. Declined as a product choice, not a
  technical one.
- **The Customer Portal's own plan switching** for subscribers, which T83 settled on for the popup. No
  billing code of ours, and the webhook already follows a changed Price. Declined for the site in favour of
  switching on our own page; still the popup's door, and the site's for cancelling and payment details.
- **Sign-in as a step of buying only**, with no signed-in state — T85's first draft. Less to build; leaves a returning customer
  unable to see their plan on the site.

## Consequences

- **The site and the popup offer a subscriber different doors**, deliberately and for now: the site its own
  Plan switch, the popup the Portal (T83). Both change the one subscription in place, and T83's `409` holds
  for any client that forgets.
- **Two sign-ins exist again** — the one 0017 was written to avoid — though against one realm, so it is one
  account.
- **The Stripe customer can carry a credit** our screens never mention; Stripe's invoices do.
