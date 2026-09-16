# ADR-0018: A subscription that ends falls back to the default tier

**Status:** Accepted (2026-08-20)
**Scope:** Full app. Refines ADR-0014 and the webhook contract T20 (#30) implements.

## Context
ADR-0014 made "every user always has a Subscription" an invariant and gave first login a row on the
`isDefault` tier with status `active`. It also concluded that `SUBSCRIPTION_INACTIVE` "only ever means a
lapsed payer".

T20 was specced as: map Stripe's status to our normalized status, copy `current_period_*`. It says nothing
about the **tier**, and following that literally produces a state nobody chose:

1. A user is provisioned on `free`, `active`. Free users are refused by `QUOTA_EXCEEDED` — never by
   `SUBSCRIPTION_INACTIVE`. That is explicit in `enforcement-contract.md`.
2. They subscribe to Pro. The row becomes `tier=pro, status=active`.
3. They cancel. The webhook writes `status=canceled`. **`tier_id` still points at Pro.**
4. `authorize` checks status before quota, so every relist is now `402 SUBSCRIPTION_INACTIVE`.

A customer who paid for three months and then cancelled ends up with **strictly less than a stranger who
never paid** — not even the free three. The invariant is preserved in the letter (a subscription exists) and
broken in the spirit (it grants nothing, forever, with no path back except buying again).

Options weighed: leave it — cancelled means cancelled; fall back to the default tier on any non-allowed
status; or fall back only on statuses that are terminal, keeping the paid tier through dunning.

## Decision
**When Stripe reports a terminal end, the webhook moves the subscription back to the `isDefault` tier with
status `active`.** The ex-customer becomes a free user again.

- **Terminal** means the subscription is over and Stripe is not going to retry: `canceled`,
  `incomplete_expired`, and a trial or period that ends without payment.
- **Not terminal** is dunning — `past_due`, `unpaid`, `incomplete`. Stripe is still retrying the card, the
  customer still believes they are a subscriber, and dropping their tier mid-retry would take away something
  a successful retry gives straight back. These keep the paid tier and stay refused by
  `SUBSCRIPTION_INACTIVE`.
- **The period reverts to ours.** A Stripe-owned window is only ever moved by its webhook (T20); once the
  fallback has happened there is no Stripe subscription to own it, so `periodStart`/`periodEnd` go back to
  the monthly roll anchored on the subscription's creation, exactly as a never-paid account's does.
- **`stripeCustomerId` is kept, `stripeSubscriptionId` is cleared.** The customer is still the same person
  with the same payment history and the same Portal; the subscription is gone. Keeping the customer id is
  what lets them resubscribe without a duplicate Stripe Customer.

## Consequences
- **Positive:** An ex-customer stays a conversion target — they keep seeing their ads, keep getting three
  relists a month, and keep seeing the upgrade prompt. Churn becomes a downgrade rather than a lockout.
- **Positive:** ADR-0014's "no code ever asks *is this user free?*" survives. There is one path back to free
  and it is the same row every free user has.
- **Consequence, and it changes the UI:** `SUBSCRIPTION_INACTIVE` **is now a dunning-only state**. ADR-0014's
  "only ever means a lapsed payer" narrows to "means a payer whose card is currently failing". The popup's
  402 copy is therefore *"your payment didn't go through — update your card"* with a Portal link, not
  *"your subscription ended — resubscribe"*. A user who actually ended their subscription never sees 402 at
  all; they see the free tier's `QUOTA_EXCEEDED` and the plan cards.
- **Negative:** A user who cancels mid-period is moved to free when Stripe says the subscription ended, which
  is at period end — so they keep what they paid for. But a user whose *dunning* finally fails loses the paid
  tier at that moment with no warning of their own; Stripe's own dunning emails are the warning, and we send
  none.
- **Negative:** Quota accounting across the boundary is not netted. Units reserved under Pro stay reserved in
  the window they were taken in; the new free window starts fresh. A user who cancels can therefore get a
  fresh three immediately. That is a rounding error at three relists and is accepted rather than modelled.

## Revisit if
Fallback becomes a farming route — cancel, get three free, resubscribe — which at three relists a month it
is not, but at a larger default quota it could be.

## Refined by ADR-0032 (2026-09-16)

**"The default tier" may now be nothing, and the fallback has to answer for that.**
[ADR-0032](0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md) makes every tier deletable, so
`TierCatalog.defaultTier()` answers an `Optional` and `SubscriptionRows.ended()` — the one statement this ADR
is — can find no tier to fall back to. Where it does, nothing here changes: status `active`, our own window
rolled from the anchor, `stripe_subscription_id` cleared and `stripe_customer_id` kept, exactly as written
above. Where it does not, the row falls back to **no tier**, keeping both Stripe ids' treatment and the window
identical, and the holder is denied `NO_TIER` until a default exists again — at which point
`PUT /api/admin/tiers/{code}/default` adopts them.

**This ADR's mechanism is what a tier deletion reuses, rather than something the delete reimplements.**
Deleting a tier cancels every live Stripe subscription on it, and each `customer.subscription.deleted` that
comes back lands here. So a subscriber whose plan was deleted takes the same path as a subscriber who
cancelled: it is the same event from their side, and the copy they see — the free tier's `QUOTA_EXCEEDED` and
the plan cards, never the 402 — is the copy this ADR already chose for them.

**"A user who cancels mid-period keeps what they paid for" does not survive a deletion, and that asymmetry is
deliberate.** Stripe ends a cancellation at period end, which is what makes the sentence above true. A deleted
tier ends at the moment of the delete, because the row the entitlement is read from is gone and there is
nowhere to keep it. The operator is told so before they confirm, and any refund is theirs to issue in Stripe.
