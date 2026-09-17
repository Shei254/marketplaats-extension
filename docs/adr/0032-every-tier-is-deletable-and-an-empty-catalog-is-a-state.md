# ADR-0032: Every tier is deletable, and an empty catalog is a state

**Status:** Accepted (2026-09-16)
**Scope:** `DELETE /api/admin/tiers/{code}`; a nullable `subscription.tier_id`; a new `stripe_cleanup` queue
and the scheduled job that drains it; a new `NO_TIER` denial on `GET /api/me` and
`POST /api/relist/authorize`; `PUT /api/admin/tiers/{code}/default`; `PriceAdoptions.adopt`; and the admin
catalog screen. **Amends [ADR-0014](0014-tier-catalog-and-entitlements.md)** on the invariant it is built on,
**refines [ADR-0018](0018-lapse-falls-back-to-the-default-tier.md)** on what a fallback does with no default
to fall back to, and **reverses [ADR-0031](0031-the-free-tier-is-the-one-without-a-price.md)**'s "deliberately
not built: a delete route" — taken the same day, on a narrower question.
T77 is the work.

**The decision is that "every user always has a Subscription" narrows to "every user always has a
subscription _row_"**, and that the row may, for a while, name no tier at all.

## Context

The session opened on symmetry — `/admin` has a create button and no delete — which is the weakest ground
this repository accepts for building anything, and it was pressed on. [ADR-0030](0030-the-catalog-order-is-the-operators.md)
refused a `featured` boolean and [ADR-0031](0031-the-free-tier-is-the-one-without-a-price.md) refused a second
free tier on exactly that ground: nobody had asked.

**The argument that survived is different, and it is about T61.** Before T61 a tier arrived only by somebody
tagging a Stripe Price in the dashboard — a deliberate act, in another system, by a person who meant it. Since
T61 a plan is one submit on a screen, so a typo in a name, a wrong rhythm or a plan created against the wrong
account gets a **permanent row** in a catalog whose entire audience is one operator staring at it. One click
creates; nothing at all undoes. That asymmetry is not aesthetic.

### What the schema said, and what it did not

`V1__baseline_schema.sql` declares the consequence beside the column: *"No delete rule, so the default is `no
action`: a tier with subscribers cannot be dropped, and retiring one is the data migration ADR-0014 says it
is."* `AdministerTiers` and `AdminCatalog.tsx` both repeat it as a reason for the missing button. Half of
that prose is **already stale** — both say the screen cannot create a tier either, and T61 shipped exactly
that — so "the API refuses it" had stopped being the reason and nobody had noticed.

`tier_single_default` is a *partial unique index*: it enforces **at most** one default. Nothing in the
database has ever enforced *at least* one. That invariant held because the seed writes one, `makeDefault`
moves the flag rather than clearing it (`TierRows` checks the target exists **before** it clears), `adopt`
never writes the column, `TierEdit` carries no `isDefault` field — and nothing deletes. So a delete route is
the first operation in this application's history that can produce a catalog with no default.

### Two things the session found that nobody had written down

**A delete does not stay deleted.** `StripeEvent.isAboutAPrice()` is true for `price.created` *and*
`price.updated`, and both reach `adopt`, which drafts a tier for a code the catalog does not know. Deleting a
tier cascades its `tier_price` rows (V7) but leaves the Stripe Prices alive and still tagged
`metadata.tier_code`. The next `price.updated` on either — an operator editing it, or Stripe emitting one for
its own reasons — brings the tier straight back at quota 0, filed last, as a `LOG.warn` nobody is reading.

**Archiving a Price does not stop the billing.** Archiving is what stops *new* purchases; existing
subscriptions keep renewing against an archived Price. So a delete that only tidied the catalog would leave
real customers paying a real monthly amount for a tier that no longer exists, and nothing anywhere would
raise it again.

### What Stripe actually offers

Checked against `stripe-java:29.2.0` on the classpath rather than from memory. **`PriceService` has no
`delete`** — `list`, `create`, `retrieve`, `update`, `search`, and that is all of it. A Stripe Price cannot be
deleted, ever; `update(active=false)` *is* Stripe's delete for one. `ProductService.delete` exists but Stripe
permits it only for a Product with no Prices attached, and since the Prices cannot be deleted, a Product that
ever had one can only be archived too.

## Decision

### Every tier is deletable, including the default and including the last

The alternatives were weighed and the narrow ones all fail on the same point: they make the operator's own
catalog something the data model has an opinion about.

- **Refuse the default; move the flag first.** Two clicks, one refusal, and the empty-catalog case falls out
  free because the last tier is necessarily the default. It preserves ADR-0014 untouched and it is the
  cheapest coherent answer. Rejected because it leaves one row permanently special for a reason that is
  internal — a foreign key and a throwing lookup — rather than one an operator would recognise.
- **Soft delete.** A `retired_at` column; the row stays and drops out of every query. No FK problem, no
  Stripe problem, deletable at any time. Rejected because the catalog then grows forever, every query gains a
  clause, and the sync can still resurrect a hidden row — it moves the problem rather than answering it.

So an empty catalog is reachable. **It is a state and not corruption**, which is the whole of what the rest
of this ADR buys.

### A subscription may name no tier

`subscription.tier_id` becomes **nullable**, and the foreign key becomes `on delete set null`.

The alternative was deleting the subscription row, which is the more literal reading of "they have no
subscription" and was rejected on three specific costs. It destroys `stripe_customer_id` — the field ADR-0018
keeps through a cancellation *precisely* so that resubscribing is the same customer buying again "rather than
a stranger with the same email". It destroys `created_at`, which is the anchor every future window is rolled
from, so every later `resetAt` for that user would jump to the date of the delete. And healing becomes a
re-insert rather than a one-line update.

**`Subscription.tier()` becomes `Optional<TierId>`** rather than a nullable component, so the compiler finds
all four production readers — `DisplayStates`, `QuotasFromReservations`, `RelistGate`, `SubscriptionRows` —
instead of each of them remembering. This is T70's argument about `BulkSelection.cap` applied where it is
cheap: a nullable field compiles just as happily at the site that forgets it.

**`ProvisionOnFirstLogin` stops throwing and provisions a tier-less row** when the catalog is empty. The
invariant it exists to keep is that an account and a subscription are created in one transaction, and that
survives; what changes is that the subscription may name nothing yet.

### `NO_TIER` is a denial, and it travels on both routes

The cheaper answer was a `503` with an empty body, and it has a real precedent:
`docs/enforcement-contract.md` says a `/api/plans` that cannot reach Stripe answers one, *"for the rule every
non-denial refusal here follows: the codes are statements about the **user**, and this is one about our
ability to answer at all."* An emptied catalog is arguably exactly that, it needs no contract change, and
every extension build already in the wild renders it as "unavailable".

**It was rejected because "unavailable, retry" is false.** No retry fixes this, and an operator may sit in an
emptied catalog deliberately. So the code is added, with its cost accepted: a client meeting a code it has
never heard of renders "something went wrong, try again" — which is the trap `BULK_NOT_ENTITLED`'s own
docstring was written to record — and every installed build does that until it updates.

**It is `NO_TIER` and not `NO_PLAN`.** [ADR-0019](0019-plans-are-stripe-first-and-webhook-synced.md) split the
two words and `glossary.md` keeps them apart: a **Plan** is a Tier joined with its Stripe Prices, so a free
user has a Tier and has never had a Plan — `NO_PLAN` would be true of them on a good day. It states a
condition rather than its cause, which is what `SUBSCRIPTION_INACTIVE`, `QUOTA_EXCEEDED` and
`BULK_NOT_ENTITLED` all do; `TIER_WITHDRAWN` was the alternative and would be the one code describing an
event.

**And it travels on `GET /api/me`, which is the half that makes it worth its contract change.**
`display-state.ts` maps every non-`200` to `unavailable` bar two — `401` is signed-out, `426` is outdated — so
a denial sent only on `authorize` would be read by nobody: the popup tells the user "unavailable" first, and
they never press the button that would have been answered honestly. It gains a third status beside those two,
which is the shape `426` already set the precedent for.

### The delete reaches into Stripe, and archiving is what "delete" means there

Three things, in this order, per tier: **cancel** every live Stripe subscription on it; **archive and untag**
every Price (`active=false` and `metadata[tier_code]=""` ride in one `price.update`); **archive** the Product.

**The untagging is the part that is not optional.** Archiving alone fires a `price.updated` that still
carries `tier_code`, which resurrects the tier that was just deleted. Cleared, the tag reads as absent —
`StripeEvent`'s `text()` answers `null` for a blank — so `taggedPrice()` is empty and `adopt` is never
called. The event the clearing itself fires is a no-op by construction.

**Cancelling is what stops the billing, and it lands on a path that already ships.** Each
`customer.subscription.deleted` runs `MirrorSubscriptions.ended()` and therefore
[ADR-0018](0018-lapse-falls-back-to-the-default-tier.md)'s fallback, which is this event from the
subscriber's side. **No automatic refund**: money is decided in Stripe (ADR-0014), where an operator can
issue one per customer, and an API that refunded on a catalog edit would be making a money decision nobody
asked it for.

**The Product is archived too**, which costs a `retrieve` per Price to learn the id — the Product id has
never been stored, and `CreateStripePlans` says of an orphaned one that it is *"harmless, invisible to this
application — nothing reads Products"*. That sentence stays true of a half-failed *create*; it is not true of
a dashboard accumulating a Product per deleted plan, which is somebody else's tidiness.

### The row goes first and the Stripe work is a queue

Cancelling cannot be undone, so the half-failure rule is the sharpest decision here. Doing Stripe first and
aborting on the first failure — T66's *"a half-made plan is reported as made"* precedent — was the
alternative, and it converges nicely on retry, since already-cancelled subscribers have been moved off the
tier by the webhook. It was rejected on the shape of the operation: this is N Stripe calls in one HTTP
request, and at any real subscriber count that is a request that times out halfway through cancelling
strangers' subscriptions.

So **the row is deleted immediately and the Stripe work is enqueued in the same Postgres transaction**, and a
`@Scheduled` job drains it — machinery that already exists, with `ReservationReconciliation` as its one
precedent.

**The work is captured, never re-derived.** Once the row is gone `tier_price` has cascaded away, the Product
id was never stored, and the ex-subscribers' `tier_id` is null and indistinguishable from anyone orphaned by
a different deletion. So the enqueue copies the Stripe ids in.

**One row per Stripe object, not one per deleted tier.** Each outstanding call carries its own attempt count
and its own last error, so a subscription Stripe refuses forever does not block the Price archiving behind
it, a stuck row is visible as itself, and retry is idempotent per object. A single blob row would have to
track which half had succeeded inside itself, or ask Stripe again every attempt.

### `adopt` refuses a code that is still being torn down

Deleting the row immediately reopens the resurrection window: the tier is gone while its Prices are still
tagged, and a `price.updated` arriving in between drafts it right back. So the sync refuses to draft a code
that has unfinished `stripe_cleanup` rows.

This is the tombstone idea that was rejected earlier in the session — a table of dead codes the sync
declines — **scoped to the window instead of forever**, which was the whole objection to it. A code frees the
moment its last cleanup row is done.

### `makeDefault` adopts the orphans

Setting the default flag also points every tier-less subscription at it, in the same transaction.

**Precise rather than merely convenient:** a subscription is tier-less *only* because no default existed, and
`makeDefault` is the sole writer of the flag, so it is the only moment that stops being true. Everyone heals
at once, including users who never sign in again, and nothing on the authorize path changes. Healing lazily
in `Subscriptions.currentFor` was the alternative — it already locks the row and already rolls a closed
window forward, on the stated grounds that *"a caller that had to notice a closed one would be a caller that
can forget to"* — and it heals one user at a time, only when they show up.

### The confirmation is proportional

A quantified warning always: how many subscribers move, how many live Stripe subscriptions will be
cancelled, and that this is the default tier if it is. **Typing the tier's name is required only when live
payers will be cancelled.**

Friction tracks consequence. Deleting a draft adopted from a mistagged Price, or a plan created thirty
seconds ago, stays one click — which is the friction T61 existed to remove. The irreversible case cannot be
done by reflex. `AdminTier` gains subscriber counts to say any of this, which the table wants anyway.

## Consequences

- **Positive.** A mistake made in one click can be undone in one click, which is what T61 left missing. The
  catalog stops being append-only.
- **Positive.** The two systems agree after a delete. Today a tier removed by hand in SQL would silently
  return; after this, the Prices are archived and untagged and there is nothing left to resurrect it.
- **Positive.** Nobody is billed for a plan that does not exist, which was reachable before this ADR only
  because no path deleted a tier at all.
- **Negative, and the largest.** ADR-0014's central invariant narrows. "No subscription never happens" was
  what kept the gate to one code path and stopped `SUBSCRIPTION_INACTIVE` meaning two things; a tier-less
  subscription is a second state, and four readers plus both clients now branch on it.
- **Negative.** Extension builds already installed render `NO_TIER` as "something went wrong, try again"
  until they update. Additive-by-default (T43) means nothing breaks, but the sentence is wrong for exactly
  the user who can do nothing about it.
- **Negative.** Deleting the last tier takes the product down for every user until a new tier is made
  default. That is now by design rather than by accident, and the confirmation says so, but it is a button an
  operator can press.
- **Negative.** A payer drops to the default tier the instant the row is deleted, before their cancellation
  is processed — the source of their entitlement is gone and there is nowhere to keep it. They lose the
  remainder of a period they paid for, and any refund is the operator's to make in Stripe.
- **Negative.** `stripe_cleanup` is this application's first durable work queue, and a row that Stripe
  refuses forever is a row somebody has to notice.
- **Deliberately not built.** Undo of any kind; a refund path; per-subscriber choice of where they land
  (they land on the default, which is where ADR-0018 already sends a cancelled customer); a second free tier;
  any user-to-tier admin route; and a `NO_TIER` variant that distinguishes "your tier was deleted" from "this
  deployment has no catalog", which are one event to a client.

## Revisit if

A subscriber count gets large enough that the confirmation's promise — "these people will be cancelled" —
outruns what the job can drain in a sensible time, at which point the screen needs to report progress rather
than report a number. Or if an emptied catalog turns out to be a state anybody *sits* in rather than passes
through, which is when `NO_TIER` earns copy of its own on the plan screen rather than a sentence in the
popup. Or if a second reason for a tier-less subscription ever appears, at which point `NO_TIER` naming a
condition rather than a cause stops being a stylistic choice and starts being load-bearing.
