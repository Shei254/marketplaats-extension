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

---

## Amended 2026-08-22 (second) — a plan may be sold at several rhythms; `tier_price` replaces the column

This ADR named the thing that made this necessary, in its own consequences:

> **Negative, and it blocks a thing you will want:** `tier.stripe_price_id` is `UNIQUE` and single-valued, so
> **a tier cannot have both a monthly and an annual Price**. A second Price tagged `pro` collides on
> `tier.code`, and it now fails inside a webhook rather than in front of a person. Annual pricing needs a
> `tier_price` table, or a nullable second column, before it is attempted.

and its *Revisit if*: "Annual or regional pricing is wanted (the `UNIQUE` constraint above is the first thing
to move)."

**A table, not the nullable second column.** A column fixes the answer at two, and the *other* thing that
revisit condition names — regional pricing — is N prices per tier and cannot be a column at all. The join
costs one index hit, which is what the column cost.

```sql
create table tier_price (
    tier_id           references tier (id) on delete cascade,
    stripe_price_id   text not null unique,          -- as before: two tiers may not share one Price
    billing_interval  text not null,
    unique (tier_id, billing_interval)               -- one price per rhythm, which makes repricing an update
);
```

**The rhythm is now stored, and that is a narrow departure from ADR-0014.** That ADR gives Stripe the amount,
the currency *and* the interval. The amount and currency are still never stored; the interval is, because a
row has to be keyed on something and "the annual one" is the only handle a buyer or an operator ever uses to
mean one of a tier's prices. `price.created` carries it, so it arrives the same way everything else about a
Price does.

**A tagged Price that does not recur is no longer adopted at all.** It has no rhythm to be filed under — and
adopting one was always wrong: it became a tier whose Checkout could never be opened, since this product sells
subscriptions. Before the rhythm was stored there was nothing to notice that with.

**What this changes for callers.**

- `GET /api/plans` carries `prices: PlanPrice[]` where it carried `price`. One card per plan, one button per
  rhythm — a toggle above the cards was considered and is worse, because plans need not offer the same
  rhythms and a global switch hides the ones that do not.
- `POST /api/checkout` requires an `interval` beside the `tierCode`. A code alone now names two prices, and a
  default would charge somebody a rhythm they did not pick. A rhythm the tier is not sold at is the same `404`
  an unknown code gets.
- `POST /api/admin/tiers/{code}/prices` adds a rhythm or reprices one, through the same `adopt` the webhook
  uses.

**Repricing is unchanged in meaning and better in scope.** A new Price tagged with the same code still
repoints the tier — but now only *that rhythm's* row, where the single column moved whatever was there. So
repricing monthly no longer silently takes annual off sale.

**V5's check constraint became a trigger**, because the invariant it stated — a published tier has something
to charge against — now spans two tables and a `check` may not. `initially immediate`, so a violation arrives
on the statement that caused it: `deferred` was tried first and is wrong twice over, since a rolled-back
transaction never commits (so a test asserting the invariant passes having checked nothing) and an exception
raised at commit is a long way from the statement a caller could report on.

**And regional pricing is now decided rather than deferred: there is one currency for the whole catalog.**
The account's own settlement currency, read from Stripe. A plan screen is a comparison, and €9,99 against
$12.99 is not one a buyer can make without knowing today's rate — so the currency is not a choice per plan,
and *since it is not a choice it is not a field*. No request this API takes carries one, which is the same
move `isDefault` made: unsayable beats validated.

That closes the collision `unique (tier_id, billing_interval)` would otherwise have — two prices in one rhythm
and two currencies — by removing the thing that would have caused it. What remains reachable is a Price
created in the Stripe *dashboard* in another currency and tagged with a tier code, which the sync would adopt;
`GET /api/plans` refuses to render a catalog priced in more than one, whole, on the all-or-nothing rule it
already keeps for a price it could not fetch.

Revisit if the product ever sells into a second currency zone. That is a bigger question than a column — the
plan cards would have to choose a currency per viewer, and Stripe accounts settle in one — and nothing about
this decision blocks it.

## Amended by ADR-0029 (2026-09-10) — a draft is still quota 0, and that was the whole argument

[ADR-0029](0029-unlimited-is-null-and-zero-still-grants-nothing.md) adds an **unlimited** tier and spells it
`null`, deliberately leaving `0` to this ADR. The alternative — `0` means unlimited — was proposed first, and
the **draft tier** above is the first of three reasons it was rejected: a Price tagged with a code the catalog
does not hold is adopted here at quota 0 and `published = false`, by a webhook, with no form and no operator
anywhere in the path. Under that alternative every draft the sync invents would be an uncapped tier held back
only by a flag, and `AdminCatalog`'s draft detector — unpublished, quota 0, priced — would have been detecting
the opposite of what it names.

`TierRows`' auto-publish is the second: `update tier set published = true where id = ? and relist_quota_per_period > 0`
means an uncapped tier spelled `0` would be the one tier that never goes on sale when its Price lands,
precisely because it is the best one. It is left exactly as written — `null` is not `> 0`, so an unlimited tier
is published deliberately rather than by the sync, which is the same care this ADR already takes with a draft.

**"Publishing a draft is an admin setting its quota" is now enforceable rather than descriptive.** ADR-0029
adds `published → (quota > 0 OR quota IS NULL)` at the three layers `V7` uses, so a draft cannot be published
while it is still a draft.

## Amended by ADR-0031 (2026-09-16) — the tag on the Price is what freezes the code, and only that

[ADR-0031](0031-the-free-tier-is-the-one-without-a-price.md) makes `tier.code` editable while a tier has no
Price, and this ADR is the reason the exception is drawn exactly there. **`metadata.tier_code` is the whole
link between the two systems**, so a tier holding Prices tagged with a code it no longer carries is a catalog
the sync cannot read: the next `price.updated` would find no tier under that tag and draft a new one at quota
0 — the tier split in two, by a rename, with its subscribers on the half nobody is looking at. Retagging every
Price in the same operation was weighed and rejected, because a local commit plus N Stripe calls half-fails
into exactly that split.

**Nothing about the sync changes.** It still adopts a tier *from* a Price, still never writes a quota, and
still takes whatever code Stripe names — including `order`, which the two write routes now refuse and the
webhook deliberately does not, since a catalog that refused rows it had already been told about would be the
worse failure.

**"No free tier is a quota of 0" is untouched**, and ADR-0031 is narrow because of it. What that spelling
could never say is what the free tier is *called*, which is now an operator's to set.

