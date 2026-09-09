# ADR-0029: Unlimited is `null`, and zero still grants nothing

**Status:** Accepted (2026-09-10)
**Scope:** The `tier` catalog, both admin wire shapes, `/api/me`, `/complete`, `/api/plans`, the admin catalog
screen and the popup's plan strip. **Refines [ADR-0014](0014-tier-catalog-and-entitlements.md)**, whose
`relist_quota_per_period` this makes nullable, and
**[ADR-0019](0019-plans-are-stripe-first-and-webhook-synced.md)**, whose draft tiers and no-free-tier switch
both depend on what `0` means. No change to the gate's order, the reservation, the pacing rails or the
internal-API layer. [T73](https://github.com/Shei254/marketplaats-extension/issues/160) is the work.

**The decision is a sentinel placement**, and the whole of it is: which of "no cap" and "grants nothing" gets
the number that already reads as one of them.

## Context

An operator needs to sell a tier with no repost cap. The obvious spelling was proposed first and is the one
this rejects: **let `0` mean unlimited**, on the reasoning that nobody would deliberately create a tier
granting nothing, so the value is free.

The value is not free. `0` is load-bearing in three places, none of them written by an operator choosing it:

1. **A draft tier is defined as quota 0.** `V5__tier_publication.sql` and [ADR-0019](0019-plans-are-stripe-first-and-webhook-synced.md):
   a Stripe Price tagged with a code the catalog does not hold is adopted at **quota 0, `published = false`**.
   `AdminCatalog.tsx` detects one by exactly that triple. The row is written by a webhook; no form is involved.
2. **"There is no free tier" *is* the default tier's quota set to 0.** [ADR-0014](0014-tier-catalog-and-entitlements.md),
   amended, rejected unsetting `isDefault` — `TierCatalog.defaultTier()` throws without it and
   `ProvisionOnFirstLogin` catches nothing — and settled on a zero quota, so that every user is still
   provisioned and every relist is refused down the path that already works.
3. **`Entitlement` says so in prose:** *"Zero is a coherent grant — a paused plan denies with
   `QUOTA_EXCEEDED` like any exhausted user, which is one code path rather than a case of its own."*

Under `0 = unlimited`, the documented way to *withdraw* the free tier becomes the way to give **every new
account** unlimited reposts — and every ex-customer with it, since [ADR-0018](0018-lapse-falls-back-to-the-default-tier.md)
falls back there. Every draft the sync invents becomes an unlimited tier held back only by a flag. And
`TierRows`' auto-publish, `update tier set published = true where id = ? and relist_quota_per_period > 0`,
inverts: the unlimited tier becomes the one tier that never goes on sale when its Price lands, precisely
because it is the best one.

**The argument that decides it is smaller than all of those.** `relist_quota_per_period = 0` reads as "no
reposts" to a person who has never opened an ADR. `0` reads as "unlimited" to nobody, ever. One of the two
meanings has to be a sentinel somebody is taught; it should be the rare one.

**And redefining `0` does not avoid a migration, it relocates one.** If `0` means unlimited, "nobody has said
what this grants" needs a new spelling, and there is no other natural number for it — so a nullable column or
a `draft` flag arrives anyway, on the common case instead of the rare one.

## Decision

### `null` is unlimited; `0` keeps meaning "grants nothing"

`tier.relist_quota_per_period` becomes **nullable**. The `check (relist_quota_per_period >= 0)` stays, and
stays honest. Nothing about drafts, the no-free-tier switch or the auto-publish rule changes.

In Java the column is `Integer` rather than `int`, which is the reason for preferring `null` over a `-1`
sentinel and not a matter of taste: `Math.max(0, -1 - held)` is `0`, which means *exhausted*, so a `-1` tier
would refuse every repost while looking like a gate that works. A `null` cannot be silently arithmetically
wrong — the compiler names every reader instead.

### The read wire mirrors the column; the write wire cannot

`GET /api/me` and `/complete` send `quotaRemaining` and `relistQuotaPerPeriod` as `number | null`. TypeScript's
strict-null does for the four clients what `Integer` does for the server.

The write side needs a rule the read side does not, and it costs
[`AdministerTiers`](../../apps/api/src/main/java/com/mprelist/admin/internal/AdministerTiers.java) a stated
principle: *"field is sent every time, so there is no 'absent or null' question for a reader to answer
differently"*. That rule rested on `null` meaning **you forgot it**, and both `asGrant()` methods refuse on it.
So on the admin `PUT` and `POST`, **absent and `null` become different**: absent is a `400`, an explicit JSON
`null` is unlimited.

The two rejected alternatives were a second `unlimitedRelists` boolean and a `number | "unlimited"` union.
Both keep the old presence check intact and both make the admin write shape differ from its own read shape and
from the column — three spellings of one fact. The boolean is also the shape this repo has now refused three
times (`tier-code.ts` on name/code, `TierEdit` on `isDefault`, and the "free tier" checkbox weighed in this
session): two fields where one is derivable from the other is a pair that can disagree.

### A published tier grants something

**`published → (relist_quota_per_period > 0 OR relist_quota_per_period IS NULL)`**, stated at the three layers
`V7` already uses for "a published tier has a price": a database trigger, a typed
`TierEdited.NothingToGrant` answer beside `NothingToChargeAgainst`, and a restatement in `CatalogEntry`'s
constructor.

This is the half of the proposal that was right, moved to where it belongs. "It makes no sense to sell a tier
granting nothing" is a rule about **publishing**, not about what the number `0` means — and it closes a real
gap rather than inventing one: the `> 0` guard existed only on the webhook auto-publish path, so an operator
could hand-publish a zero-grant tier and a buyer could pay for it.

**The operator never meets the refusal.** The form warns and then sends `published: false` itself, which is
`NewPlanForm`'s existing habit — *"Said here rather than sent to an API that would refuse a blank, which is a
round trip to be told what is already visible on this form."* Since `TierEdit` is a whole `PUT`, withdrawing
and zeroing are one submit. The refusal is the backstop for a stale tab, a script or a hand-run `curl`, and
those should be told they are wrong rather than quietly corrected — which is why the API does not silently
auto-unpublish and answer `200 Applied` about a row that is not what arrived.

### Unlimited changes the comparison and nothing else

`authorize` still takes a **UsageReservation**, under the same lock, and `/complete` still settles it and
writes a `RelistEvent`. The only difference is that the quota comparison never refuses; `RemainingQuota`
answers `null` and `isSpent()` is false. The held-count query may be skipped, since nothing reads the number.

Not spending a unit was weighed and is the trap in this ADR. `SafetyPolicy` counts **attempts**, and an
attempt is a reservation — so an unmetered tier would silently lose the minimum interval and the burst limit,
and "unlimited per period" would become unlimited per minute for the users doing the highest volume on their
own Marktplaats accounts. `RelistEvent` would stop being written for them too, taking the **breakage canary**
with it. [ADR-0025](0025-bulk-repost-is-entitled-queued-and-paced-wider.md)'s rule stands unchanged and is
what makes "unlimited" honest: a bigger plan buys more reposts per **period**, and the same ten an hour as
everybody else.

### What the user sees

An unlimited tier's strip is the tier name and **"Unlimited reposts"** — no bar and no date, mirroring the
`paymentFailing` branch that already drops both for the opposite reason. A meter draws a proportion and there
is no ceiling to draw against; a permanently full bar is decoration shaped like data, identical after five
hundred reposts and after none. A reset date on a tier with no limit invites the reader to believe there is
one.

Showing usage instead — *"Unlimited · 137 this period"* — is the better screen and is deliberately not built
here: it needs a `used` count on a wire shape this ADR is already changing, and it is worth its own ticket
rather than a rider on this one.

**The zero-grant state gets its own reading**, because this ADR is what makes `0` worth being precise about.
A tier granting 0 is not *exhausted*, and `ExhaustedPrompt` currently tells its holder their reposts *"come
back on 14 Sep"* when they come back as 0. The strip reads "No reposts on this plan", the prompt drops the
date and offers plans.

### The default tier may be unlimited, and is warned about

Nothing forbids ticking it on the `isDefault` row, and forbidding it was rejected: a self-hosted single-user
deployment — the posture [ADR-0014](0014-tier-catalog-and-entitlements.md) says this architecture preserves —
*is* default tier, unlimited, no Stripe, and refusing it would leave that setup with only a large fake number
to express itself, which is the sentinel lie this ADR exists to avoid. The form warns instead, naming the
reach: every new account, and every subscription that ends ([ADR-0018](0018-lapse-falls-back-to-the-default-tier.md)).

### Users read "repost"; the code keeps "relist"

Found while writing the copy above, and decided here because the new strings had to pick a word: the button
says **Repost**, the strip above it says **relists**, and the admin quota field says both — label *"Relists per
period"*, hint *"How many reposts a subscriber gets each period."*

Users read **repost** everywhere. Internal identifiers keep **relist**: `POST /api/relist/authorize`,
`RelistEvent`, `RelistGate`, `relistQuotaPerPeriod` on the wire and the column. This is the split the glossary
already draws between the **Brand name** and `mprelist`, and it is deliberate rather than tolerated. T73
renames only `relistsLeft`, which would otherwise sit one line from "Unlimited reposts";
[T74](https://github.com/Shei254/marketplaats-extension/issues/161) brings the rest into line.

## Consequences

- **Positive.** `0` keeps the meaning it reads as, so drafts, the no-free-tier switch and the auto-publish rule
  are untouched. The two publish paths agree for the first time. The compiler — Java's and TypeScript's —
  enumerates every reader of a quota rather than leaving them to be found. A self-hosted deployment becomes
  expressible without a fake number.
- **Negative.** A nullable column is a third state every future reader of a quota must handle, and the admin
  write API now answers "absent" and "null" differently from every other field on the same request — a local
  exception to a rule stated in prose one class over, which is why it is written down here.
- **Deliberately not built.** A `used` count for unlimited tiers; `max_marktplaats_accounts` gains no
  unlimited (it is 1 on every tier until T38); nothing in Stripe changes, because a quota was never Stripe's
  ([ADR-0014](0014-tier-catalog-and-entitlements.md)).
- **Open at build time, not a decision.** Distinguishing an absent JSON field from an explicit `null` on a
  record has no precedent in this codebase — `@JsonCreator` appears twice, both on value types — so the
  mechanism is to be verified rather than assumed when T73 is built.
