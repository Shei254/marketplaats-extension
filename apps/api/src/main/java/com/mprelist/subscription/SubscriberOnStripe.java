package com.mprelist.subscription;

import java.util.Optional;
import java.util.UUID;

/**
 * Which subscription Stripe is talking about, and whose it is — the three identifiers a webhook carries
 * before anything has been decided about what it says (#30, T20).
 *
 * <p><strong>Two of the three find a row and the first of them is ours.</strong> The tag names an account
 * directly; the customer id is what a subscription created outside our own Checkout is found by, once some
 * earlier event stored it. The subscription id is carried for what is <em>written</em> and said in a log
 * rather than for looking anything up — see {@link SubscriptionMirror}. A subscriber this application has
 * never heard of matches neither, which is a state and not a fault.
 *
 * @param subscriptionId Stripe's {@code sub_…}, the subscription this event is about
 * @param customerId Stripe's {@code cus_…}, the customer holding it. Kept for ever once known: ADR-0018 has a
 * cancellation clear the subscription and keep the customer, so that resubscribing continues one billing
 * history and the Customer Portal (T21, #31) has something to point at
 * @param taggedAccount our own {@code app_user} id, as {@code OpenCheckout} wrote it into the subscription's
 * metadata when the session was opened — or empty for a subscription created some other way. This is the
 * thread that makes an event self-identifying: it rides every event about that subscription for the whole of
 * its life, including the cancellation three months later, where the Checkout session that started it is long
 * out of sight
 */
public record SubscriberOnStripe(String subscriptionId, String customerId, Optional<UUID> taggedAccount) {

	public SubscriberOnStripe {
		if (subscriptionId == null || subscriptionId.isBlank()) {
			throw new IllegalArgumentException("An event about no subscription is not one to mirror");
		}
		if (customerId == null || customerId.isBlank()) {
			throw new IllegalArgumentException("Every Stripe subscription has a customer, so an event carrying "
					+ "none is not one this application can read");
		}
		if (taggedAccount == null) {
			throw new IllegalArgumentException("A subscription either carries our tag or does not; null is a "
					+ "third answer nothing here knows how to read");
		}
	}

}
