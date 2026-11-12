-- A Scheduled switch, as Stripe's subscription schedule last said it (T90, ADR-0042).
--
-- A subscriber may choose a plan that takes over when their paid period ends. Stripe holds that as a
-- Subscription Schedule; this row holds the one thing both clients render of it — which Price, from when — so
-- `GET /api/me` reads it here and never asks Stripe (ADR-0019). The tier and the Rhythm are read off the Price
-- through the catalog, as `stripe_price_id`'s are, so only Stripe's handle is stored.
--
-- At most one is pending. Set by `subscription_schedule.*` events while a schedule has a phase after the
-- current one; cleared when the schedule ends, when the subscription ends or is set to cancel at period end
-- (a cancellation always wins), and when the subscription arrives at the pending Price, which is the switch
-- taking over.
--
-- Ordered by `pending_mirrored_through` rather than `mirrored_through`: a schedule's events and its
-- subscription's interleave, and a renewal stamped a second later does not make a schedule made just before it
-- old news. Both columns null together means nothing is pending.
alter table subscription
    add column pending_price_id text,
    add column pending_at timestamptz,
    add column pending_mirrored_through timestamptz;
