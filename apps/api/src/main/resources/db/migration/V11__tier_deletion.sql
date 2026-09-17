-- Every tier is deletable, and an empty catalog is a state (T77; ADR-0032).
--
-- V1 wrote the opposite beside the column it wrote it on -- "No delete rule, so the default is `no action`: a
-- tier with subscribers cannot be dropped, and retiring one is the data migration ADR-0014 says it is" -- and
-- that sentence was the whole of why `/admin` has a create button and no delete. What changed is not the
-- foreign key's difficulty but what is on the other side of the screen: since T61 a plan is one submit, so a
-- typo, a wrong rhythm or a plan made against the wrong Stripe account is a permanent row in a catalog whose
-- entire audience is one operator. One click creates; nothing at all undid it.
--
-- Two things follow, and the second is the larger.

-- **A subscription may name no tier.**
--
-- ADR-0014's "every user always has a Subscription" narrows to "every user always has a subscription *row*",
-- and the row may for a while name nothing. `on delete set null` rather than `cascade`, because the row is
-- what keeps `stripe_customer_id` -- which ADR-0018 holds through a cancellation precisely so that
-- resubscribing is the same customer buying again "rather than a stranger with the same email" -- and
-- `created_at`, the anchor every later `resetAt` is rolled from. Deleting the row would move a returning
-- subscriber's every future window to the day an operator tidied the catalog.
--
-- It is reachable exactly one way: the tier somebody was on was deleted and there was no *other* default to
-- move them to. `AdministerTiers` moves subscribers to the default first and this rule is what catches the
-- rest -- the default tier itself, and the last tier there is. `PUT /api/admin/tiers/{code}/default` then
-- adopts every orphan in one statement, which is the only moment "no default exists" stops being true.
alter table subscription
    alter column tier_id drop not null;

alter table subscription
    drop constraint subscription_tier_id_fkey;

alter table subscription
    add constraint subscription_tier_id_fkey foreign key (tier_id) references tier (id) on delete set null;


-- **The Stripe half of a delete is a queue.**
--
-- Cancelling cannot be undone, so the half-failure question is the sharpest one here. Doing Stripe first and
-- aborting on the first refusal is T66's precedent -- "a half-made plan is reported as made" -- and it was
-- rejected on the shape of this operation rather than on the principle: this is N Stripe calls inside one
-- HTTP request, and at any real subscriber count that is a request which times out halfway through
-- cancelling strangers' subscriptions. So the row goes immediately, the work is captured in the same Postgres
-- transaction, and a `@Scheduled` job drains it -- machinery `ReservationReconciliation` already established.
--
-- **The work is captured, never re-derived.** Once the tier row is gone `tier_price` has cascaded away (V7),
-- the Stripe Product id was never stored at all, and the ex-subscribers' `tier_id` is null and
-- indistinguishable from anyone orphaned by a different deletion. So the enqueue copies the Stripe ids in
-- while they still exist.
--
-- **One row per Stripe object, not one per deleted tier.** Each outstanding call carries its own attempt
-- count and its own last error, so a subscription Stripe refuses for ever does not block the Price archiving
-- behind it, a stuck row is visible as itself, and each retry is idempotent against one object. A single blob
-- row would have to track which half of itself had succeeded, or ask Stripe again on every attempt.
create table stripe_cleanup (
    id          uuid        primary key default gen_random_uuid(),
    -- The code of the tier that was deleted, kept although the row it named is gone: it is what
    -- `PriceAdoptions.adopt` reads to refuse a code that is still being torn down, and what an operator
    -- reading this table would look for. No foreign key, deliberately -- the tier it names is deleted by
    -- definition, and a reference to it is exactly what this table exists to survive.
    tier_code   text        not null,
    -- Which call is outstanding. A check constraint rather than an enum type, for V1's reason on
    -- `subscription.status`: widening a check is one migration line.
    kind        text        not null check (kind in ('cancel_subscription', 'archive_price',
                                                    'archive_product')),
    -- The Stripe object the call is about -- `sub_...`, `price_...` or `prod_...` as the kind says. Opaque
    -- here: this module stores it and `billing` is the only thing that knows what to do with one.
    stripe_id   text        not null,
    attempts    integer     not null default 0 check (attempts >= 0),
    -- Stripe's own words about the last refusal, for the operator who has to notice a row that will not
    -- drain. Null until something has gone wrong.
    last_error  text,
    enqueued_at timestamptz not null default now(),
    -- When Stripe agreed. Null is "outstanding", which is the whole of what every query here asks.
    done_at     timestamptz
);

-- What `adopt` asks on every `price.created` and `price.updated`, and what the drain scans. Partial, because
-- a drained row is of interest to nobody and this table only ever grows.
create index stripe_cleanup_outstanding on stripe_cleanup (tier_code) where done_at is null;

-- One outstanding call per Stripe object. It makes the enqueue idempotent -- two of a tier's Prices share one
-- Product, so the drain offers the same `archive_product` twice by construction -- and it is partial for the
-- same reason the index above is: a Product archived for a tier deleted in March says nothing about a Product
-- archived for a tier deleted in June, and the two could be the same id if somebody recreated the plan.
create unique index stripe_cleanup_one_outstanding_call_per_object
    on stripe_cleanup (kind, stripe_id) where done_at is null;
