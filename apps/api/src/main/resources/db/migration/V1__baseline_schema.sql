-- The five backend-owned tables of docs/domain-model.md, and the constraints that make the invariants
-- around them unwriteable rather than merely documented.
--
-- Nothing here holds a Marktplaats credential or session (ADR-0001/0005): an ad appears as the bare
-- identifier the extension already knows, and that is the whole of what the backend learns about it.
--
-- Applied migrations are immutable — Flyway validates the checksum of every file it has already run, so
-- a correction to this file after it has been applied anywhere is a new V2, never an edit here.


-- An app account. One human, one row, created on first login (#20).
create table app_user (
    id               uuid        primary key default gen_random_uuid(),
    -- The `sub` claim of the access token — today Keycloak's — and the only thing we hold about the human.
    -- Kept beside our own id rather than used as it: ADR-0009 wants Keycloak replaceable, and making
    -- every foreign key in this file an IdP identifier is the cheapest way to make it permanent. Named for
    -- the role rather than the vendor for the same reason: swapping the IdP should not need a rename.
    idp_subject      text        not null unique,
    created_at       timestamptz not null default now()
);


-- A plan in our catalog. Money lives in Stripe, limits live here (ADR-0014).
create table tier (
    id                       uuid        primary key default gen_random_uuid(),
    -- The stable handle: what the #18 seed upserts on and what an operator names a tier by. `name` is
    -- display text an admin may rewrite at any time, so it cannot be the thing anything references.
    code                     text        not null unique,
    name                     text        not null,
    relist_quota_per_period  integer     not null check (relist_quota_per_period >= 0),
    max_marktplaats_accounts integer     not null check (max_marktplaats_accounts >= 1),
    -- Feature flags (bulk, scheduling, …) as data, so adding one is an admin edit rather than a
    -- migration and a deploy. An object rather than an array of names: a flag that later needs a value
    -- ("bulk up to 20") then stays in the same column.
    features                 jsonb       not null default '{}'::jsonb
                                         check (jsonb_typeof(features) = 'object'),
    is_default               boolean     not null default false,
    -- Nullable on purpose: the free tier is an ordinary row that happens to have no Stripe Price
    -- (ADR-0014). Unique, because two tiers pointing at one Price would make the webhook's
    -- Price → Tier lookup ambiguous.
    stripe_price_id          text        unique,
    created_at               timestamptz not null default now()
);

-- ADR-0014: at most one tier is the default. Partial, and that is the point — a plain
-- `unique (is_default)` would equally forbid a *second non-default* tier, i.e. a catalog of one.
create unique index tier_single_default on tier (is_default) where is_default;


-- The user's current plan: our tier, Stripe's status and period.
create table subscription (
    id                     uuid        primary key default gen_random_uuid(),
    -- Exactly one row per user. The domain model's "no subscription is unreachable" is half of the
    -- invariant and #20 provides it; this unique is the other half, and the half that cannot lapse.
    app_user_id            uuid        not null unique references app_user (id) on delete cascade,
    -- No delete rule, so the default is `no action`: a tier with subscribers cannot be dropped, and
    -- retiring one is the data migration ADR-0014 says it is.
    tier_id                uuid        not null references tier (id),
    -- Stripe's status, normalized to the set enforcement-contract.md names. A check constraint rather
    -- than an enum type: Stripe adds statuses, and widening a check is one migration line where
    -- narrowing an enum is not possible at all.
    status                 text        not null
                                       check (status in ('active', 'trialing', 'past_due', 'canceled',
                                                         'unpaid', 'incomplete', 'incomplete_expired')),
    -- The quota window usage is counted in. Copied from Stripe for payers, rolled monthly from
    -- provisioning for free users, so `resetAt` is always answerable.
    period_start           timestamptz not null,
    period_end             timestamptz not null,
    -- Both null until a checkout completes: a free subscription has no Stripe counterpart at all.
    stripe_customer_id     text        unique,
    stripe_subscription_id text        unique,
    created_at             timestamptz not null default now(),
    constraint subscription_period_runs_forward check (period_end > period_start)
);


-- One quota unit, held from `authorize` until `complete` settles or refunds it.
--
-- The unit lives here rather than on relist_event because an in-flight relist has to hold one: the
-- extension is between the delete and the create, and nothing has been reported yet. A refund is then a
-- status change on this row, and #24's reconciliation of abandoned reservations is the same change.
create table usage_reservation (
    id          uuid        primary key default gen_random_uuid(),
    app_user_id uuid        not null references app_user (id) on delete cascade,
    ad_id       text        not null,
    status      text        not null default 'RESERVED'
                            check (status in ('RESERVED', 'SETTLED', 'REFUNDED')),
    reserved_at timestamptz not null default now(),
    -- The authorization token's own expiry, ~45s out (enforcement-contract.md § Anti-stockpiling).
    -- #24 looks for RESERVED rows past this plus a grace window; a row is never refunded merely for
    -- being expired, since the relist it authorized may still be running.
    expires_at  timestamptz not null,
    -- When the row stopped holding its unit, whichever way it went. Not `settled_at`: a refund resolves a
    -- reservation as surely as a settlement does, and both are terminal.
    resolved_at timestamptz,
    constraint usage_reservation_resolved_at_matches_status
        check ((status = 'RESERVED') = (resolved_at is null))
);

-- Usage in a period: rows in [period_start, period_end) that still hold their unit.
create index usage_reservation_holding_a_unit on usage_reservation (app_user_id, reserved_at)
    where status <> 'REFUNDED';

-- What the extension reported about a relist it was authorized for.
--
-- At most one row per reservation, which is what the unique below holds. That there is *exactly* one for
-- every reservation that settled or refunded is #23's to keep: a FAILED_BEFORE_DELETE costs no quota but is
-- the signal that Marktplaats moved something (enforcement-contract.md), and a table that dropped those
-- would be blind to exactly the failure it exists to reveal.
--
-- Which user and which ad are on the reservation and are not repeated here — the reservation is one row
-- away through a not-null foreign key, and a second copy is a second thing that can disagree.
create table relist_event (
    id             uuid        primary key default gen_random_uuid(),
    -- Unique, and the reservation id is the `jti`: a second report for one authorization collides here
    -- rather than depending on the service to have remembered the first. That buys at-most-once, which is
    -- the floor `complete`'s idempotency stands on and not the whole of it — the contract also wants the
    -- second call to answer `{quotaRemaining, resetAt}` rather than fail, and translating this collision
    -- into that answer is #23's job.
    reservation_id uuid        not null unique references usage_reservation (id) on delete cascade,
    outcome        text        not null
                               check (outcome in ('SUCCESS', 'FAILED_BEFORE_DELETE',
                                                  'FAILED_AFTER_DELETE')),
    recorded_at    timestamptz not null default now()
);
