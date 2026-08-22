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

---

## Amended 2026-08-22 — a plan may be **created** from `/admin`; Stripe still owns the amount

The second condition above was met the moment `/admin` existed (T54, #85): the screen showed a catalog it
could edit and a list of untagged Prices it could not act on, and creating a plan still meant leaving for
another tab, remembering a metadata key, and coming back.

**What changes.** `POST /api/admin/plans` creates the Stripe Product and Price and then the tier, in one
submit. `GET /api/admin/currencies` is what the form's currency list is built from.

**What does not change, and it is the whole of why this is an amendment rather than a reversal.** The
argument this ADR rejected the third option on was:

> The third is the nicest until the first price change. Stripe Prices are immutable … A form field labelled
> "amount" would therefore be lying about what **editing** it does.

That is an argument about editing, and it still stands. **No amount is editable anywhere.** It is written
once, into the system that owns it, and repricing is still done in Stripe — where a new Price tagged with the
same `tier_code` repoints the tier through the sync exactly as it always has. The form says so on its face,
which is better than the previous arrangement, where the constraint existed and no screen mentioned it.

**No new writer of the `tier` table.** The route composes three calls and the last two already existed:

1. `billing` creates a Product and a Price tagged `metadata.tier_code`;
2. `PriceAdoptions.adopt` makes the row — the same call `ReceiveStripeEvents` makes;
3. `TierEdits.apply` sets the quota and the flags — the same call `PUT /api/admin/tiers/{code}` makes.

The `price.created` Stripe delivers moments later finds the row already right and is the no-op `adopt` was
always documented to be. So "a webhook syncs it into the Tier catalog" is still true of every plan, however it
was created — which is what keeps this cheap.

**Three things the amendment had to decide.**

- **A code the catalog already holds is refused (`409`), before Stripe is asked.** The upsert's ordinary
  behaviour is to repoint that tier's Price, which is right for a webhook and wrong for a button labelled
  *New plan*: every current subscriber would go on paying the old amount while the tier advertised a new one.
- **Stripe's refusal carries its own words** — a `422` with a `problem`, the one body in this API that is a
  sentence rather than a code. "Amount must be at least 50 cents for usd" is not something a status can say
  and is exactly what the operator has to act on. It is deliberately not called `reason`: that is this API's
  vocabulary for a denial about a *user*.
- **The currency list is asked of Stripe, not listed anywhere.** Stripe supports around 130 currencies; this
  *account* supports what its country spec allows. A hardcoded list offers a currency that renders a plan card
  and fails at Checkout, and goes stale the day Stripe adds one.

**A gap this exposed, and closed.** Repricing repoints the tier, which leaves every existing subscriber
matched to a Price no tier carries — and the mirror used to drop their events entirely on that basis. Their
*status* therefore stopped being mirrored: a failing card left the row saying `ACTIVE`, so they went on
relisting while Stripe retried, and the recovery would not have landed either. (Cancellation still worked,
since that path never reads a price, which is what kept it quiet.) An unrecognised Price now costs only the
tier change: the status and window are mirrored and the subscriber keeps the tier they bought. This was true
before the amendment — anyone repricing in the dashboard hit it — and is fixed with it because the amendment
makes repricing something people will actually do.
