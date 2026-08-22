package com.mprelist.billing;

/**
 * What came of asking Stripe to create a plan (on #84's screen).
 *
 * <p>Two answers and no exception, like every other outcome this module hands back: the caller turns each into
 * a different status, and the difference matters to an operator staring at a form they have just filled in.
 */
public sealed interface PlanCreation {

	/**
	 * Stripe made it. What comes back is the {@link com.mprelist.catalog.TaggedPrice}-shaped facts the sync
	 * needs — deliberately the same three the webhook would have carried, so the row is written by the one
	 * code path that has always written it.
	 */
	record Created(String stripePriceId, String tierCode, String name) implements PlanCreation {
	}

	/**
	 * Stripe could not be asked, or refused. The message is Stripe's own, because it names what is wrong with
	 * the request — an unsupported currency, an amount below the minimum chargeable — better than anything
	 * this application could infer, and the person reading it is an operator rather than a user.
	 */
	record Refused(String because) implements PlanCreation {
	}

}
