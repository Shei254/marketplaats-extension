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
	LEFT_TO_THE_TIER_THAT_HOLDS_IT,

	/**
	 * A tier under that code was deleted and its Stripe objects are still being torn down, so nothing was
	 * adopted (T77, ADR-0032).
	 *
	 * <p><strong>This closes the window a delete opens, and the window is real.</strong> The row goes at once
	 * while its Prices are still alive in Stripe and still tagged {@code metadata.tier_code}; the drain then
	 * archives and untags each of them, and until it has, any {@code price.updated} on one — an operator
	 * editing it, or Stripe emitting one for reasons of its own — would draft the deleted tier straight back
	 * at quota 0, filed last, as a log line nobody is reading.
	 *
	 * <p><strong>Scoped to that window and not to the code.</strong> A table of dead codes the sync declines
	 * for ever was weighed and rejected in the ADR: an operator who deletes a plan and recreates it under the
	 * same name is doing something ordinary. This frees the moment the code's last {@code stripe_cleanup} row
	 * is done.
	 *
	 * <p>An operator's to notice rather than to act on, like {@link #DRAFTED_A_TIER} and unlike
	 * {@link #LEFT_TO_THE_TIER_THAT_HOLDS_IT}: it is the expected answer for the seconds or minutes between a
	 * delete and its drain, and it stops on its own.
	 */
	REFUSED_A_CODE_BEING_TORN_DOWN

}
