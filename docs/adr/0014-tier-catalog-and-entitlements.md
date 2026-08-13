# ADR-0014: Tier catalog and entitlements owned by us, keyed to Stripe Prices

**Status:** Accepted (2026-08-13)
**Scope:** Full app. Refines ADR-0006, which said "subscription state is authoritative in Stripe".

## Context
ADR-0006 chose Stripe Billing and called Stripe authoritative. But the product needs **custom tiers added by
an admin**, and a tier is mostly *entitlement* data — relists per period, max Marktplaats accounts, feature
flags. Stripe Prices carry an amount, a currency and an interval; they are not an entitlement store. Stripe's
Entitlements API exists but its features are essentially boolean lookup keys, so numeric quotas would still
need somewhere else to live.

Three options: our own Tier table keyed to a Stripe Price; Stripe Price `metadata` as the source of truth;
or Stripe's Entitlements API.

## Decision
Draw the line at **money vs. limits**:

- **Stripe owns** amount, currency, interval, the subscription lifecycle (including trials), dunning,
  proration, and the hosted Customer Portal.
- **We own** the `Tier` catalog in Postgres: name, quota per period, max Marktplaats accounts, feature flags,
  an `isDefault` flag, and a **nullable** `stripePriceId` linking to the Stripe Price.

`authorize` resolves Entitlement from our `Tier` table and **never calls Stripe on the hot path**.

### Every user always has a Subscription
The free tier is an **ordinary `Tier` row** with `stripePriceId = null` and `isDefault = true`. On first login
the backend auto-provisions a Subscription onto the default tier with status `active`. Consequently:

- **No code ever asks "is this user free?"** — the gate reads Entitlement and denies with `QUOTA_EXCEEDED`
  like any other user. One code path.
- **"No subscription" never happens**, so it cannot ambiguously mean both "free user" and "never signed up".
- **Removing the free tier is a data migration**, not a refactor: unset `isDefault`, migrate the rows.
- `SUBSCRIPTION_INACTIVE` therefore only ever means a **lapsed payer**, and the locked state becomes
  "you've used your 3 — upgrade" rather than "subscribe to find out".

### Quota period
`periodStart`/`periodEnd` live on the **Subscription**, not derived per tier type: copied from Stripe's
current period for paid subscriptions (so you meter exactly the window you bill), rolled monthly from the
provisioning date for free ones. `resetAt` is therefore always answerable.

### Trials
Trial length is a billing-lifecycle property and stays **entirely in Stripe** — an admin sets trial days on
the Price or at checkout. The webhook mirrors `status: trialing` plus `trial_end`, and `trialing` is already
an Allowed status, so trials need **zero application code** and can be changed or withdrawn from the Stripe
dashboard.

## Consequences
- **Positive:** Quotas are tunable without touching billing; the admin tier UI becomes possible at all;
  no Stripe dependency near the authorize path; the self-hostable posture of ADR-0009 is preserved.
- **Negative:** Two systems to keep in sync — creating a tier means creating a Stripe Product/Price and
  storing its id. **Open question deliberately deferred:** what happens to existing subscribers when a tier's
  quota is edited underneath them. Deferred with the admin CRUD UI (ADR see `enforcement-contract.md`).
