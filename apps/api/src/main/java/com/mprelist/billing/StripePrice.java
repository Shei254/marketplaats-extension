package com.mprelist.billing;

/**
 * What a Stripe Price costs, as this application renders it (T49, #80).
 *
 * <p>Three fields and no more: the amount, the currency it is in, and how often it recurs. Everything else a
 * Stripe Price carries — its nickname, its metadata, whether it is active — is either somebody else's
 * business or already in our own table.
 *
 * <p><strong>It is never stored</strong> (ADR-0014/0019). Money lives in exactly one place and it is not this
 * database; what we hold is a cache of what Stripe said, which is a different thing from a second copy of
 * record. The difference shows the day an amount is wrong: there is nothing here to correct, because
 * correcting it means creating a new Price in Stripe.
 *
 * @param amount in the currency's smallest unit, as Stripe counts it — 999 is €9.99. Carried as Stripe
 * carries it rather than converted, because a decimal here would be a rounding decision made in the wrong
 * building
 * @param currency ISO 4217, lower case, as Stripe writes it
 * @param interval how often it recurs — {@code month} or {@code year} in Stripe's vocabulary. A Price with no
 * recurrence is not something this product sells, so one never becomes a {@link StripePrice}
 */
public record StripePrice(long amount, String currency, String interval) {

	public StripePrice {
		if (amount < 0) {
			throw new IllegalArgumentException("A price cannot be negative; " + amount + " came from Stripe");
		}
		if (currency == null || currency.isBlank() || interval == null || interval.isBlank()) {
			throw new IllegalArgumentException("A price needs a currency and an interval to mean anything");
		}
	}

}
