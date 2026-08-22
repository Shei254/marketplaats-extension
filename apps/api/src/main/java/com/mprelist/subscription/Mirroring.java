package com.mprelist.subscription;

/**
 * What became of one Stripe event, for the caller that has an operator to tell (#30, T20).
 *
 * <p>An answer rather than an exception for {@code Adoption}'s reason: every one of these is a thing that
 * happens in normal running, the webhook answers {@code 200} to all of them, and the difference between them
 * is a log line rather than a status. Four are ordinary — a plan moved, a plan moved on a repriced tier, a
 * plan ended, an event that had already been overtaken — and two are an operator's to act on.
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
	 * The status and the window are now Stripe's, and the tier is the one the row already held — because the
	 * Price this subscription is for belongs to no tier any more.
	 *
	 * <p><strong>Which is what repricing a plan does to everybody already on it.</strong> Stripe Prices are
	 * immutable, so a new amount is a new Price and the sync moves {@code tier.stripe_price_id} onto it; every
	 * existing subscriber goes on paying through the old one, which now matches no tier. Keeping their tier is
	 * right — they are on the plan they bought — and mirroring the rest of the event is what stops a card that
	 * starts failing from leaving the row saying {@code ACTIVE} while Stripe retries it.
	 *
	 * <p>An operator's to notice rather than to act on: it is the expected state after a reprice, and it stops
	 * on its own as those subscribers cancel or move. What it is <em>not</em> is a reason to have skipped the
	 * event, which is what this used to be called {@code NO_TIER_SELLS_THAT_PRICE} for and what it used to do.
	 */
	MIRRORED_ONTO_THE_TIER_THEY_WERE_ALREADY_ON,

	/**
	 * A newer event has already been mirrored onto this row, so this one says nothing that is still true.
	 * A redelivery of an old event and a retry that overtook its own successor are the same case, and this is
	 * where both stop.
	 */
	SAID_BEFORE_WHAT_IS_ALREADY_MIRRORED

}
