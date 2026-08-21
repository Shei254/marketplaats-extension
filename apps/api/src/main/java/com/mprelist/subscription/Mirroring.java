package com.mprelist.subscription;

/**
 * What became of one Stripe event, for the caller that has an operator to tell (#30, T20).
 *
 * <p>An answer rather than an exception for {@code Adoption}'s reason: every one of these is a thing that
 * happens in normal running, the webhook answers {@code 200} to all of them, and the difference between them
 * is a log line rather than a status. Three are ordinary — a plan moved, a plan ended, an event that had
 * already been overtaken — and two are an operator's to act on.
 */
public enum Mirroring {

	/** The tier, the status and Stripe's own window are now what Stripe last said they were. */
	MIRRORED,

	/**
	 * Stripe reported the end of it, so the subscriber is a free user again — the default tier, {@code active},
	 * and the window back on our monthly roll (ADR-0018). Never a lockout, which is the whole of that decision.
	 */
	FELL_BACK_TO_THE_DEFAULT_TIER,

	/**
	 * Nothing here is billed as that customer, holds that subscription, or carries that tag. A subscription
	 * created in the Stripe dashboard for somebody who has never signed in looks exactly like this, and so does
	 * one belonging to a different deployment pointed at the same Stripe account.
	 */
	NOBODY_HERE_IS_BILLED_AS_THAT,

	/**
	 * The subscription is live, and the Price it is for belongs to no tier in our catalog — so there is nothing
	 * to grant and the row is left exactly as it was, on whatever it was on. A Price created without a
	 * {@code metadata.tier_code} tag and then sold is the way here (ADR-0019).
	 */
	NO_TIER_SELLS_THAT_PRICE,

	/**
	 * A newer event has already been mirrored onto this row, so this one says nothing that is still true.
	 * A redelivery of an old event and a retry that overtook its own successor are the same case, and this is
	 * where both stop.
	 */
	SAID_BEFORE_WHAT_IS_ALREADY_MIRRORED

}
