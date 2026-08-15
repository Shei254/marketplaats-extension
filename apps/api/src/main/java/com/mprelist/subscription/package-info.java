/**
 * The mirror of Stripe's view of a subscription: normalized status, period, Stripe ids. Its public API is
 * {@link com.mprelist.subscription.SubscriptionStatus}, {@link com.mprelist.subscription.Subscription} and
 * {@link com.mprelist.subscription.Subscriptions} (ADR-0012), with the Stripe client to be confined to
 * {@code internal/stripe} so that it stays a replaceable adapter (ADR-0009).
 *
 * <p>Two things live here today. The listener that provisions a subscription on the default tier when
 * {@code identity} creates an account (#20), which is what makes ADR-0014's "no subscription is unreachable"
 * true; and the read #22's gate authorizes against — which tier the caller is on, whether that subscription
 * entitles them to anything, and the window their usage is counted in. That read is also where a free
 * subscription's window is rolled when it has closed, because this module owns the window and the only
 * alternative is a caller that can forget to. The Stripe half arrives with #30 (T20) and is what will move a
 * payer's window instead.
 */
@ApplicationModule
package com.mprelist.subscription;

import org.springframework.modulith.ApplicationModule;
