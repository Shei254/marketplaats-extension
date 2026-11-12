package com.mprelist.subscription;

import java.time.OffsetDateTime;

/**
 * A <strong>Scheduled switch</strong>: the Price a subscription moves to when its paid period ends, as Stripe's
 * subscription schedule last said it (T90, ADR-0042). At most one per subscription.
 *
 * <p>Stripe's handle for the Price and nothing else, for {@code stripe_price_id}'s reason: which tier it sells
 * and at which Rhythm are the catalog's to answer.
 *
 * @param stripePriceId the Price that takes over
 * @param at when it does, which is the end of the period they have paid for
 */
public record PendingSwitch(String stripePriceId, OffsetDateTime at) {

	public PendingSwitch {
		if (stripePriceId == null || stripePriceId.isBlank() || at == null) {
			throw new IllegalArgumentException("A pending switch names the Price it moves to and the day it does");
		}
	}

}
