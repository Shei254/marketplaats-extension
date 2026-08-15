/**
 * The mirror of Stripe's view of a subscription: normalized status, period, Stripe ids. Its planned public
 * API is {@code SubscriptionStatus}, with the Stripe client confined to {@code internal/stripe} so it stays
 * a replaceable adapter (ADR-0009, ADR-0012).
 *
 * <p>Nothing public yet. What it holds today is the listener that provisions a subscription on the default
 * tier when {@code identity} creates an account (#20), which is what makes ADR-0014's "no subscription is
 * unreachable" true. The Stripe half, and the status this module will publish, arrive with #30 (T20).
 */
@ApplicationModule
package com.mprelist.subscription;

import org.springframework.modulith.ApplicationModule;
