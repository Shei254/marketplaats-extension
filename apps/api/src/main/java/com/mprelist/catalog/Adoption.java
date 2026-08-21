package com.mprelist.catalog;

/**
 * What became of a {@link TaggedPrice} the catalog was offered (#82, T51).
 *
 * <p>Returned rather than logged here, so the module that received the event is the one that says how loud
 * each of these is — {@code catalog} has no idea it was a webhook, and the two that need saying out loud need
 * saying to an operator watching Stripe rather than to a reader of this table.
 */
public enum Adoption {

	/**
	 * A tier already carried the code, so it now carries the Price. Its quota is untouched — ADR-0019's
	 * central rule, and {@code V2__seed_tier_catalog.sql}'s own: a Price tagged {@code pro} fills in the
	 * seeded {@code pro} row and leaves its 50 alone.
	 */
	FILLED_IN_A_TIER,

	/**
	 * No tier carried the code, so one now exists at quota 0 and unpublished. It grants nothing and cannot be
	 * bought until an operator says what it is for (T53, #84) — which is the state ADR-0019 wants a Price that
	 * exists before anybody has decided what it sells.
	 */
	DRAFTED_A_TIER,

	/**
	 * Another tier already holds that Price, and it keeps it.
	 *
	 * <p>Reachable only by re-tagging a Price that was already adopted, which is an operator's mistake and not
	 * a fault to retry: {@code tier.stripe_price_id} is unique, so taking it would mean quietly leaving the
	 * first tier unsellable. Nothing is written, and the caller is the one that has to make it visible.
	 */
	LEFT_TO_THE_TIER_THAT_HOLDS_IT

}
