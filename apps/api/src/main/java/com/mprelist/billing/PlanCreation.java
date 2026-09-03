package com.mprelist.billing;

import java.util.List;

/**
 * What came of asking Stripe to create a plan (on #84's screen).
 *
 * <p>Two answers and no exception, like every other outcome this module hands back: the caller turns each into
 * a different status, and the difference matters to an operator staring at a form they have just filled in.
 */
public sealed interface PlanCreation {

	/**
	 * Stripe made it. What comes back is the {@link com.mprelist.catalog.TaggedPrice}-shaped facts the sync
	 * needs — deliberately the same ones the webhook would have carried, so the rows are written by the one
	 * code path that has always written them.
	 *
	 * <p><strong>{@code prices} is what Stripe actually made, which since T66 is not always what was
	 * asked for.</strong> A plan sold two ways is two Price calls with no transaction spanning them, so the
	 * annual one can fail once the monthly one exists — and at that point the monthly Price is real, carries
	 * the tag, and is about to be adopted whatever this says. Reporting the lot as refused would be a claim
	 * about Stripe that is untrue, and would leave the operator's retry colliding with a tier code the sync
	 * had meanwhile taken. Never empty: a plan with no Price at all is a {@link Refused}.
	 */
	record Created(String tierCode, String name, List<CreatedPrice> prices) implements PlanCreation {

		public Created {
			if (prices == null || prices.isEmpty()) {
				throw new IllegalArgumentException("A plan with nothing to charge against was not created; "
						+ "that answer is a Refused");
			}
			prices = List.copyOf(prices);
		}

	}

	/**
	 * One Price Stripe made: its id and the rhythm it is filed under.
	 *
	 * <p>The interval is the one that was <em>asked for</em> rather than one read back off Stripe's answer,
	 * and the two are the same string by construction. It is what the catalog keys the price on, so a plan
	 * sold two ways is told apart by nothing else.
	 */
	record CreatedPrice(String stripePriceId, String interval) {
	}

	/**
	 * Stripe could not be asked, or refused. The message is Stripe's own, because it names what is wrong with
	 * the request — an unsupported currency, an amount below the minimum chargeable — better than anything
	 * this application could infer, and the person reading it is an operator rather than a user.
	 */
	record Refused(String because) implements PlanCreation {
	}

}
