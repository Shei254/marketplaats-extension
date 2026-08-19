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

## Amended by ADR-0018 and ADR-0019 (2026-08-20)

**"`SUBSCRIPTION_INACTIVE` only ever means a lapsed payer" narrows to *a payer whose card is currently
failing*.** [ADR-0018](0018-lapse-falls-back-to-the-default-tier.md) makes a terminal subscription end move
the row back to the `isDefault` tier with status `active`, so a cancelled customer becomes a free user rather
than a locked-out one. Only dunning — `past_due`, `unpaid`, `incomplete` — still answers 402.

**"Removing the free tier is a data migration" is refined.** Unsetting `isDefault` is *not* the way to do it:
`TierCatalog.defaultTier()` throws when no row carries the flag and `ProvisionOnFirstLogin` catches nothing,
so a catalog with no default cannot provision anybody. There must always be a default tier. "No free tier" is
instead **the default tier's quota set to 0**, which `check (relist_quota_per_period >= 0)` already permits:
every new user is still provisioned, the invariant holds, and every relist is refused by `QUOTA_EXCEEDED`
down a path that already works.

**The deferred admin CRUD is un-deferred, in the narrow form ADR-0019 describes.** Iteration 1 gets quota,
name, flags, `isDefault` and publish — not amount or interval, which are Stripe's. `tier` gains a
**`published`** flag so a Price synced before anyone has said what it grants sells nothing.

**The remaining deferral stands and is now partly answered.** What happens to existing subscribers when a
quota is edited underneath them: `quotaRemaining` is clamped at zero, so lowering a quota under a subscriber
reads as "nothing left" rather than as a negative. Nothing else is done — no proration, no notification.

**Trials:** the section above still describes how one would work. None ships in iteration 1
([ADR-0006](0006-billing.md), amended).
