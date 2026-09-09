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

## Amended by ADR-0026 (2026-09-06)

**"Iteration 1 gets quota, name, flags, `isDefault` and publish" is refined on the word *flags*.**
[ADR-0026](0026-a-feature-flag-is-a-field-spelled-once.md) makes the `features` column a field an operator
types rather than a JSON textarea, now that [ADR-0025](0025-bulk-repost-is-entitled-queued-and-paced-wider.md)
has put a value in it. The catalog stays exactly as this ADR describes it — an open `jsonb` object, so adding
a flag is still an admin edit rather than a migration and a deploy — and what changes is only who spells the
shape: `packages/contracts/src/features.ts`, read from there by both the admin form that writes a flag and
the popup that reads one.

**"Off" acquires a spelling.** A flag an operator turns off is written `{"bulk": false}` and **not** removed
from the object. `Entitlement.grants` and the popup have always answered *not granted* for both, so this
changes no reader; it is decided for the seed's sake. `V8__seed_bulk_entitlement.sql` writes only where the
key is absent and claims of itself that the admin edit is the durable way to take a flag off a tier — a claim
a deleted key would falsify on any restored dump, in a file Flyway's checksum forbids correcting.

## Amended by ADR-0029 (2026-09-10)

**`relist_quota_per_period` becomes nullable, and `null` means *unlimited*.**
[ADR-0029](0029-unlimited-is-null-and-zero-still-grants-nothing.md) adds a tier with no cap per period. The
split this ADR draws is untouched — money is still Stripe's and limits still ours, and a quota with no ceiling
is as much ours as one with — so nothing in Stripe changes to sell one.

**The zero-quota spelling above survived being challenged, and that is the decision.** The obvious alternative
was to let `0` mean unlimited on the grounds that nobody would create a tier granting nothing. It is rejected
in ADR-0029 because `0` is written by things other than an operator: the sync adopts a **draft** at `0`
(ADR-0019), "there is no free tier" is the default tier at `0` (this file, amended above), and `TierRows`
auto-publishes on `relist_quota_per_period > 0`. A `0` that meant unlimited would hand every new account — and
every ex-customer, since ADR-0018 falls back here — an uncapped tier by the same gesture that withdraws the
free one.

**"Zero is a coherent grant" gains a limit: it cannot be *sold*.** The amendment above un-deferred the admin
CRUD with `published` as its gate, and ADR-0029 adds the invariant that was missing beside
`tier_is_published_only_with_a_price`: **a published tier grants something**, `published → (quota > 0 OR quota
IS NULL)`. It closes a gap rather than adding a rule — the `> 0` guard existed only on the webhook path, so a
zero-grant tier could be hand-published and bought.

**The remaining deferral is still deferred.** What happens to existing subscribers when a quota is edited under
them is unchanged: `quotaRemaining` clamps at zero, no proration and no notification. An edit *to* unlimited
needs nothing extra — the subtraction simply stops being done.
