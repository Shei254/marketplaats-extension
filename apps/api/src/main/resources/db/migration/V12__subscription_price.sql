-- Which Stripe Price the subscription is being billed at, as Stripe last said (T85, ADR-0036).
--
-- The tier was always mirrored and the Price was read only to find it, then dropped. Two things now need the
-- Price itself: a Plan switch has to name the subscription's current Price to change it, and the site has to
-- know which Rhythm somebody pays so that their own card can offer the other one. The *amount* is still never
-- stored — ADR-0014's rule — only the id, which is Stripe's handle for it.
--
-- Written by every mirrored event, including one whose Price no tier sells (a repriced plan), because it is
-- what Stripe is charging whatever our catalog makes of it; cleared with `stripe_subscription_id` when a
-- subscription ends (ADR-0018). Null on every row until the first event after this migration, which for a
-- subscriber who was already paying means "rhythm unknown" until their next renewal says it.
alter table subscription
    add column stripe_price_id text;
