# ADR-0019: Plans are created in Stripe and synced to the Tier catalog by webhook

**Status:** Accepted (2026-08-20)
**Scope:** Full app. Refines ADR-0014; un-defers the admin tier CRUD ADR-0014 deferred.

## Context
ADR-0014 split money from limits: Stripe owns amount, currency and interval; we own quota, max accounts and
flags; `stripePriceId` is the link. It named the cost of that split honestly — "two systems to keep in sync
— creating a tier means creating a Stripe Product/Price and storing its id" — and deferred the admin CRUD
that would make the second half bearable.

Two things then came due at once. Iteration 1 sells something, so the popup has to render **prices** — and
nothing in our database holds one. And the operator has to be able to say what a tier grants, including
whether the free tier grants anything at all.

That last one turned out to be cheaper than expected and to need saying out loud. "No free tier" does **not**
mean no default tier: `TierCatalog.defaultTier()` throws when no row carries the flag, and
`ProvisionOnFirstLogin` deliberately catches nothing, so unsetting `isDefault` breaks every new sign-in. But
`relist_quota_per_period` is `check (>= 0)` — **zero is legal**. An operator who wants no free tier sets the
default tier's quota to 0. Every new user is still provisioned, the invariant holds, and every relist is
refused by `QUOTA_EXCEEDED` down a path that already works end to end.

For creating a *paid* plan, three options were weighed: the admin creates the Product and Price in Stripe and
pastes the price id into our form; the admin creates them in Stripe and a webhook syncs a tier row; or the
admin fills one form here and the backend creates the Product and Price in Stripe.

The third is the nicest until the first price change. **Stripe Prices are immutable** — €9.99 does not become
€11.99, a new Price is created and the tier repointed, and existing subscribers stay on the old one. A form
field labelled "amount" would therefore be lying about what editing it does.

## Decision
**Stripe is where a plan is created. A webhook syncs it into the Tier catalog. The admin gives it a quota
here.**

- The admin creates the Product and Price in Stripe, tagged **`metadata.tier_code`** — the stable handle
  ADR-0014 already made the thing anything references.
- `price.created` and `price.updated` **upsert on `tier_code`**, writing `name` and `stripePriceId` and
  **never touching a quota**. A Price tagged `pro` fills in the seeded `pro` row and leaves its 50 alone.
  This is the rule `V2__seed_tier_catalog.sql` already states for itself: "adds only what is missing and
  overwrites nothing."
- An unrecognised `tier_code` inserts a **draft**: quota 0, `published = false`. `tier` gains that column.
  A draft cannot be bought, so a Price that exists before anybody has said what it grants sells nothing.
- The admin publishes it from `/admin` by setting the quota and flags. **That is the whole of tier CRUD in
  iteration 1** — quota, name, flags, `isDefault`, publish. Amount and interval are not editable here,
  because they are not ours.
- **`GET /api/plans`** reads the published tiers and their amounts **from Stripe**, cached. It is display,
  not the hot path, so ADR-0014's "authorize never calls Stripe" is untouched. Money still lives in exactly
  one place; we hold a cache of it and never a second copy of record.
- **The metadata tag is required.** A Price without one is not a plan. Stripe Prices get created for one-offs,
  coupons and experiments, and a sync that adopted all of them would turn a billing experiment into a tier.

## Consequences
- **Positive:** One catalog of record for money, one for entitlements, and an id that cannot drift because
  nobody types it twice.
- **Positive:** Quota and price are edited where each actually lives, and neither UI has to pretend it can
  change the other.
- **Positive:** "Should there be a free tier, and how big" is one editable number on one row. It needs no
  code, no new state, and no branch — the exhausted-user path already renders it.
- **Negative:** The operator works in two places to launch a plan, and has to remember the metadata tag.
  A missing tag is silent: the Price exists, nothing appears in `/admin`, and the only symptom is absence.
  The admin tier list should therefore show unadopted Prices rather than only what it has adopted.
- **Negative, and it blocks a thing you will want:** `tier.stripe_price_id` is `UNIQUE` and single-valued, so
  **a tier cannot have both a monthly and an annual Price**. A second Price tagged `pro` collides on
  `tier.code`, and it now fails inside a webhook rather than in front of a person. Annual pricing needs a
  `tier_price` table, or a nullable second column, before it is attempted.
- **Negative:** `GET /api/plans` puts Stripe on a request path a user waits on. It is cached and it is not
  the gate, but a Stripe outage makes the plan cards unavailable — which must render as "prices unavailable,
  retry", never as a free plan or a wrong price.

## Revisit if
Annual or regional pricing is wanted (the `UNIQUE` constraint above is the first thing to move), or the
two-place workflow proves error-prone enough that a backend-creates-the-Price form is worth its migration
story.
