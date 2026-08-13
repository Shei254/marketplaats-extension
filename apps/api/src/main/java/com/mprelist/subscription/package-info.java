/**
 * The mirror of Stripe's view of a subscription: normalized status, period, Stripe ids. Its planned public
 * API is {@code SubscriptionStatus}, with the Stripe client confined to {@code internal/stripe} so it stays
 * a replaceable adapter (ADR-0009, ADR-0012).
 *
 * <p>Empty until #20 (T11) and #30 (T20).
 */
@ApplicationModule
package com.mprelist.subscription;

import org.springframework.modulith.ApplicationModule;
