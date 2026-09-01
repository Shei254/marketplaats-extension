package com.mprelist.billing.internal;

import java.time.Instant;

/**
 * One remembered answer and when it stops being one.
 *
 * <p>Shared by {@link CachedStripePrices} and {@link CachedPaymentMethods} because it is the same shape in
 * both: something Stripe said, and the instant it stops being worth repeating. Their TTLs mean different
 * things — one bounds how long a mistake is shown, the other is real staleness, and each class says so where
 * a reader would change it — but neither difference is in the holder, and two copies of a two-line record
 * are two places to fix a freshness bug.
 *
 * <p>{@code isFresh} is exclusive at the boundary: an answer held {@code until} an instant is stale
 * <em>at</em> it, so a TTL of zero remembers nothing rather than remembering for one tick.
 *
 * @param <T> what was remembered — a {@code StripePrice}, or the list of methods a buyer may pay with
 */
record Remembered<T>(T answer, Instant until) {

	boolean isFresh(Instant now) {
		return now.isBefore(this.until);
	}

}
