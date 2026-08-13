-- The catalog itself: the three tiers #21 resolves an Entitlement from and #20 provisions every new user
-- onto. Money is Stripe's (ADR-0006); these limits are ours (ADR-0014).
--
-- A V2 rather than three more lines in V1, because V1 has been applied and Flyway validates the checksum
-- of every file it has already run.
--
-- Seeded here, not owned here. ADR-0014 makes the catalog admin-managed, so this adds only what is
-- missing and overwrites nothing: a quota an operator has since edited stays edited, and re-applying the
-- file — a restored dump, a hand-run — is a no-op rather than a second catalog. The arbiter is named
-- (`on conflict (code)`) deliberately: a *different* tier already flagged default is not this file's
-- conflict to swallow, and should collide on tier_single_default loudly.
--
-- Not an `R__` repeatable migration, which would re-run on every edit: by the rule above a re-run changes
-- nothing, so the form would promise that editing a number below re-seeds it, and this file cannot keep
-- that promise. Changing a live catalog is an admin edit or its own migration.
insert into tier (code, name, relist_quota_per_period, max_marktplaats_accounts, is_default)
values
    -- ADR-0014's own example of the locked state is "you've used your 3 — upgrade". The default tier, so
    -- #20 provisions every new user onto it and "no subscription" stays the unreachable state ADR-0014
    -- wants; free users are denied by QUOTA_EXCEEDED, never by SUBSCRIPTION_INACTIVE.
    ('free',  'Free',  3,   1, true),
    -- Roughly a relist or two a day, and roughly half a dozen. specs/quota-enforcement.md puts the
    -- concrete numbers outside its scope — they are configuration, and changing one is an operator
    -- editing a row, not a release. Neither number is a rate: pacing and burst are #25's SafetyPolicy,
    -- and a month's quota spent in a minute is exactly what that check exists to refuse.
    ('pro',   'Pro',   50,  1, false),
    ('power', 'Power', 200, 1, false)
on conflict (code) do nothing;

-- Three columns every row above leaves alone, each for its own reason:
--
-- `max_marktplaats_accounts` is 1 everywhere. It becomes a sellable entitlement only once #47 finds a
-- stable Marktplaats account identifier — until then nothing can tell two of them apart, so a tier
-- promising three would be selling something unobservable. The column stays in the schema because the
-- domain model has always modelled the association (docs/domain-model.md); only the selling waits.
--
-- `features` keeps its `{}` default. The flags the domain model names — bulk, scheduling — have no
-- implementation and no ticket, and a seeded `"bulk": true` would be an entitlement to a feature that
-- does not exist, rendered by #26's `/api/me` as though it did. Quota is the whole ladder today.
--
-- `stripe_price_id` is null on all three. Free has none by design (ADR-0014); Pro and Power have none
-- *yet* — #28 creates the Products and Prices by hand in the Stripe dashboard, and a migration after it
-- fills the ids in. Until that lands a tier with no price cannot be checked out, so #29 has nothing to
-- sell and #43's plans page can only show what the user already has.
