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
accounts established in the EU and the UK — see the correction below, which is about whether this one is.
Enabling it is a dashboard setting, and this decision already
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
account. Reporting which methods are actually enabled is T65 (#137) and
[ADR-0022](0022-the-plan-screen-names-the-payment-methods.md)'s.

## Corrected 2026-09-01 — the EU account is a **requirement**, not a fact about this one

The amendment above read "to accounts based in the EU — **which this one is**". It is not, and the whole of
that amendment's "no code changes, just a checkbox" rests on it.

The account `MPRELIST_STRIPE_SECRET_KEY` points at answers `country: us`, `default_currency: usd`,
`details_submitted: false`, and every Price on it is in USD. PayPal there is not turned off — it is **not a
field on any of the account's payment method configurations at all**, because Stripe does not offer PayPal
to US-established merchants. There is no checkbox to tick, so T64's "the only step that is not documentation
is a dashboard checkbox" cannot be performed on this account by anyone.

**The same fact takes the rest of this decision with it.** iDEAL is EUR-only, and it bills a *subscription*
by leaving a SEPA Direct Debit mandate behind — and SEPA Direct Debit reads `available: false` on a US
account. A `subscription` Checkout there resolves to `["card", "cashapp"]`. That is the card-only
arrangement this ADR rejected in its first paragraph, arrived at silently, on the reasoning that Dutch
buyers pay by iDEAL.

**So this decision now carries an account precondition, and it is not a preference.** The Stripe account
must be established where Stripe offers iDEAL, SEPA Direct Debit and PayPal — the Netherlands, for this
product — and the catalog must be priced in EUR. **A misplaced account does not fail loudly.** Checkout
opens, a card form renders, a test card completes a subscription, and every screen looks correct; what is
missing is the two methods this ADR exists to keep. That is true of a *test* account as much as a live one:
what is being tested otherwise is not this decision.

T57 (#88) carries it for live. What the plan screen may claim in the meantime is
[ADR-0022](0022-the-plan-screen-names-the-payment-methods.md)'s, amended the same day so that it can no
longer name a method a subscription Checkout will not render.

## Amended 2026-09-02 — the account precondition is met, and Checkout presents **our** currency

The correction above set an account precondition. It is now met: `MPRELIST_STRIPE_SECRET_KEY` answers
`country: nl`, `default_currency: eur`, the account's own default payment method configuration carries
`paypal` as `available: true` / `on` beside `ideal` and `sepa_debit`, and a `subscription` Checkout on it
resolves to `card, ideal, sepa_debit, klarna, link, paypal, amazon_pay, satispay`. Everything the amendment
before last said would follow from a Dutch account does follow from one.

**And PayPal was still missing from the page.** Not for any of the reasons written down so far — not the
country, not the recurring approval T57 is watching, not domain registration (that binds Elements and the
embedded form; this integration redirects to `checkout.stripe.com`, which is Stripe's own domain). The cause
is **Adaptive Pricing**, which is on by default and converts a session into the buyer's local currency.
Stripe's rule for the converted ones is one sentence: *for cross-border subscriptions, Adaptive Pricing
supports only card payments, Link, Apple Pay and Google Pay.* A buyer opening the plan screen from Nairobi
is shown KES, and KES takes iDEAL, SEPA and PayPal off the page together — the exact card-only arrangement
this ADR rejected in its first paragraph, reached for the third time by a third route.

**So the session is pinned to the Price's own currency**, `adaptive_pricing.enabled = false` in
`OpenCheckout`, and the buyer is shown euros wherever they are.

**This is a parameter in code, and that is not the rule above being broken.** `OpenCheckout` keeps payment
methods in the dashboard because naming them here "would put a second answer beside the dashboard's". That
rule is about *which* methods to offer. This is about the **currency they are offered in**, which is upstream
of the list rather than a second copy of it: a method that cannot be presented in the session's currency was
never a choice anybody made, and no dashboard page shows the two facts together. Left as the account-wide
toggle it also is, one tick deletes the three methods this decision exists to keep, silently, for every buyer
outside the eurozone.

**Negative, and the reason this took a day to find.** It is invisible to every instrument we have.
`payment_method_types` is resolved when the session is *created*; the conversion happens when the page is
*opened*. So the session object, and the log line `OpenCheckout` added for exactly this purpose, both name
`paypal` on a session whose buyer will never be shown it. Two sessions created a minute apart — one with
Adaptive Pricing on, one off, both with a Kenyan buyer — return byte-identical method lists.

**Negative:** a non-eurozone buyer now pays their own bank's FX rather than Stripe's 2–4% conversion fee, and
sees a price in a currency that is not theirs. For a product sold to Dutch marketplace sellers that is the
right side of the trade; a product with buyers spread across currencies would weigh it the other way.

**Revisit if** this product ever sells outside the eurozone on purpose, at which point Adaptive Pricing is
worth having back — and the price of having it is the method list, so it would need per-currency prices
(`currency_options`, which Adaptive Pricing steps aside for) rather than a converted session.
