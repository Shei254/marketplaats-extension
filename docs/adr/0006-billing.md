# ADR-0006: Subscription billing — Stripe Billing

**Status:** Accepted (2026-07-25)
**Scope:** Full app only.

## Context
Subscriptions require recurring billing, dunning, proration, a customer portal, and EU VAT handling. Users are Dutch, where iDEAL is the dominant payment method and SEPA direct debit is common for recurring — so card-only would hurt conversion. Options weighed: Stripe Billing, Mollie (Dutch/iDEAL-native), and Merchant-of-Record (Paddle/Lemon Squeezy).

## Decision
**Stripe Billing**, with **iDEAL and SEPA enabled**. Integrated with the Spring Boot backend via Stripe **webhooks** as the source of subscription state. **Stripe Tax** used for EU VAT calculation.

## Consequences
- **Positive:** Best-in-class subscription lifecycle (recurring, proration, dunning/retries, hosted customer portal); iDEAL + SEPA preserve Dutch conversion; clean Spring Boot webhook integration.
- **Negative:** US vendor; iDEAL-as-recurring runs through the SEPA mandate flow; we still file VAT ourselves (Stripe Tax calculates, does not file).
- Subscription state is authoritative in Stripe; our backend mirrors it via webhooks and is the entitlement source for the extension (see quota-enforcement ADR).

## Amended by ADR-0014 (2026-08-13)
"Authoritative in Stripe" is narrowed to **money and lifecycle**. Stripe owns amount, currency, interval,
subscription status, trials, dunning, proration, and the Customer Portal. The **Tier catalog and all
entitlements (quota, max accounts, feature flags) are ours**, in Postgres, keyed to a Stripe Price — because
admin-defined custom tiers are entitlement data that Stripe Prices cannot carry. `authorize` never calls
Stripe. See [ADR-0014](0014-tier-catalog-and-entitlements.md).

## Revisit if
EU VAT filing becomes a burden we want fully offloaded → reconsider a Merchant-of-Record; or a Dutch-provider mandate emerges → reconsider Mollie.

## Amended by ADR-0019 (2026-08-20)
**No trial ships in iteration 1.** The permanent free tier is the trial: three relists a month, forever,
converting on the exact ad the user wanted to bump. A time-boxed trial of a paid tier on top of that is a
second free experience the plan cards would have to explain.

This costs nothing to reverse. `trialing` is already an allowed status in the schema check constraint and in
`enforcement-contract.md`, and T20 mirrors it with no special-casing — so turning a trial on later is
`trial_period_days` on a Stripe Price in the dashboard, a configuration change and not a code change.

**How a plan comes to exist is settled by [ADR-0019](0019-plans-are-stripe-first-and-webhook-synced.md):**
created in Stripe, synced to our Tier catalog by webhook on `metadata.tier_code`, given a quota here. Prices
are immutable in Stripe, so amounts are never editable in our admin — changing one mints a new Price and
leaves current subscribers on the old one.

## Amended 2026-09-01 — PayPal is a payment **method**, not a second processor

The ask was "add PayPal alongside Stripe so users have an option for both". It has two readings, they are
three orders of magnitude apart, and picking the reading *is* the decision.

**PayPal is not an alternative to Stripe.** Stripe offers PayPal as a payment method, for subscriptions, to
accounts based in the EU — which this one is. Enabling it is a dashboard setting, and this decision already
put payment methods there: `OpenCheckout` sets no `payment_method_types`, because "naming them in code would
mean a deploy to add one, and would put a second answer beside the dashboard's". So PayPal joins iDEAL, SEPA
and card by a checkbox, and **no code changes**.

**The other reading was costed and rejected**, and is written down here so nobody has to cost it twice:

- `subscription.stripe_customer_id` and `stripe_subscription_id` are `unique` and named for one processor
  (`V1__baseline_schema.sql`); a second needs two more columns and a discriminator.
- `mirrored_through` is **one ordering cursor over one event stream** (`V6__subscription_mirror.sql`). Two
  streams need two, and the "older than" guard becomes per-stream.
- `tier_price.stripe_price_id` is `not null unique` under `unique (tier_id, billing_interval)`
  (`V7__tier_prices.sql`), so a PayPal plan for a rhythm collides with the Stripe one holding it.
- A second signed webhook receiver beside `ReceiveStripeEvents`, with PayPal's own verification.
- **PayPal has no Customer Portal.** `OpenPortal` would have to branch, and *this ADR's whole reason for
  choosing Stripe* — the hosted lifecycle: cards, invoices, proration, cancellation — would be rebuilt by hand
  for half the customers.
- Stripe Tax calculates the EU VAT this decision leans on. PayPal does not, so filing would come off two sets
  of numbers.

That is weeks against a checkbox, and it buys exactly one thing: **independence from Stripe as a vendor**. The
buyer sees a PayPal button either way.

**Revisit if** PayPal money must settle into a PayPal account rather than through Stripe — a fee or
vendor-risk reason, never a UX one — or if Stripe stops offering PayPal for EU subscriptions.

**What the buyer is *told* about any of this is a separate decision**, because it has a separate revisit
condition: the copy pass here only stops describing Stripe as a card processor, which it never was on this
account. Reporting which methods are actually enabled is T65 (#137) and ADR-0022's.
