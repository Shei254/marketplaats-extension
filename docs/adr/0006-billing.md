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
