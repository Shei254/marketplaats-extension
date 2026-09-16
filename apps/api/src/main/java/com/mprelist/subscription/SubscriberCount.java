package com.mprelist.subscription;

/**
 * How many people a tier has on it, and how many of them are paying for it (T77, ADR-0032).
 *
 * <p>Two numbers rather than one, because a delete has two different consequences and only one of them is
 * irreversible. Moving somebody to the default tier is a change they will see; cancelling their Stripe
 * subscription is money that stops and a period they paid for that they lose the remainder of. The
 * confirmation in {@code /admin} says both and asks for the tier's name to be typed only for the second.
 *
 * @param subscribers every account on the tier, payers included — how many rows move
 * @param payingSubscribers how many of them Stripe is currently billing, which is how many live subscriptions
 * the tear-down will cancel. Always at most {@code subscribers}, and zero on every free tier and every draft
 */
public record SubscriberCount(int subscribers, int payingSubscribers) {

	/** A tier nobody is on — what a caller reads for a row the count query did not name. */
	public static final SubscriberCount NOBODY = new SubscriberCount(0, 0);

	public SubscriberCount {
		if (subscribers < 0 || payingSubscribers < 0) {
			throw new IllegalArgumentException("A tier cannot have fewer than nobody on it: " + subscribers
					+ " subscribers, " + payingSubscribers + " of them paying");
		}
		if (payingSubscribers > subscribers) {
			throw new IllegalArgumentException("More payers than subscribers is a count of two different "
					+ "things: " + payingSubscribers + " of " + subscribers);
		}
	}

}
