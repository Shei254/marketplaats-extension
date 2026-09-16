/**
 * The mirror of Stripe's view of a subscription: normalized status, period, Stripe ids. Its public API is
 * {@link com.mprelist.subscription.SubscriptionStatus}, {@link com.mprelist.subscription.Subscription} and
 * {@link com.mprelist.subscription.Subscriptions} (ADR-0012), with the Stripe client to be confined to
 * {@code internal/stripe} so that it stays a replaceable adapter (ADR-0009).
 *
 * <p>Three things live here. The listener that provisions a subscription on the default tier when
 * {@code identity} creates an account (#20), which is what makes ADR-0014's "no subscription is unreachable"
 * true; the read #22's gate authorizes against — which tier the caller is on, whether that subscription
 * entitles them to anything, and the window their usage is counted in, which is also where a free
 * subscription's window is rolled when it has closed, because this module owns the window and the only
 * alternative is a caller that can forget to; and since #30 (T20) the write on the other side of that,
 * {@link com.mprelist.subscription.SubscriptionMirror} — what Stripe says about a subscription, turned into
 * the plan somebody is on.
 *
 * <p>Since T77 there is a third port, {@link com.mprelist.subscription.TierSubscribers}, and it is what a
 * catalog edit does to the people in this table (ADR-0032): a tier being deleted moves everybody off it, and
 * a default flag arriving somewhere adopts everybody who was left naming nothing. Nothing on it is about one
 * user — every method takes a tier — which is what makes it safe to publish at all, and both of its writes
 * are composed with {@code catalog}'s own half in one transaction by {@code admin}. The column behind it is
 * {@code tier_id}, which V11 makes nullable: "every user always has a Subscription" narrows to "every user
 * always has a subscription <em>row</em>", and {@link com.mprelist.subscription.Subscription#tier()} is an
 * {@code Optional} so that the compiler names every reader rather than each of them remembering.
 *
 * <p>The mirror is a second port rather than more methods on {@code Subscriptions}, for the reason
 * {@code catalog} keeps {@code PriceAdoptions} apart from {@code TierCatalog}: one is read by the gate on
 * every relist and the other is written to by a webhook. It is also where ADR-0018 lives — a subscription
 * Stripe has finished with puts its holder back on the default tier rather than leaving them on a paid one
 * they are refused by — because what a row becomes is this module's to decide and not the caller's to
 * describe. A payer's window moves here and nowhere else.
 */
@ApplicationModule
package com.mprelist.subscription;

import org.springframework.modulith.ApplicationModule;
