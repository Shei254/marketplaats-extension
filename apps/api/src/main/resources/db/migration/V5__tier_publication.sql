-- Whether a tier may be sold (#82, T51). ADR-0019 makes Stripe the place a plan is created and this catalog
-- the place it is given a quota, which leaves a window where a tier row exists and nobody has yet said what
-- it grants — a Price tagged with an unknown code is adopted as a draft at quota 0. `published` is what
-- keeps that draft out of `GET /api/plans` (#80) and out of a Checkout session (#29).
--
-- Default false, so the three tiers V2 seeded are unpublished the moment this runs. Free stays that way for
-- good: it is not something a buyer chooses, and ADR-0019 keeps it off the plan cards. Pro and Power are
-- published by the sync itself, when the Price tagged with their code arrives — a tier with a quota and no
-- Price is not sellable either, so publishing them here would be publishing something nobody can buy.
alter table tier
    add column published boolean not null default false;

-- Published means buyable, and buying needs a Price. Written as a constraint rather than left to the two
-- readers to remember, for V1's reason: an invariant a query has to remember is one a later query forgets.
-- It costs the sync nothing — every tier row this application creates is created *from* a Price — and it is
-- what stops T53's admin publish from offering a tier whose Checkout session could not be opened.
alter table tier
    add constraint tier_is_published_only_with_a_price
        check (not published or stripe_price_id is not null);
