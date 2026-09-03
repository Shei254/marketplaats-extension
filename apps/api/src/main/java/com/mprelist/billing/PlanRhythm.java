package com.mprelist.billing;

import java.util.Set;

/**
 * One rhythm a plan is to be sold at, and what it costs there (T66).
 *
 * <p><strong>Monthly and annual are one plan, so they are created together.</strong> T62 (#128) made a tier
 * able to hold several Stripe Prices and left the creating form able to write one, which meant the second
 * rhythm was a separate act an operator had to remember — and a plan sold at one rhythm is a plan whose card
 * offers no choice. Carrying the rhythms as a list is what lets one submit produce one Product and a Price
 * per rhythm.
 *
 * @param amount in the currency's smallest unit, as Stripe counts it — 999 is €9.99. <strong>Zero is
 * allowed</strong>, for {@link NewPlanInStripe}'s reason: a free-of-charge recurring Price is a thing Stripe
 * holds, and refusing it here would decide something this type has no business deciding
 * @param interval how often it recurs, in Stripe's vocabulary — {@code day}, {@code week}, {@code month} or
 * {@code year}, and nothing else. What tells one of a plan's prices from its others, here and in the catalog
 */
public record PlanRhythm(long amount, String interval) {

	/**
	 * The four recurrences Stripe bills by.
	 *
	 * <p><strong>Checked here rather than where the Price is built</strong>, which is the difference between
	 * a {@code 400} and a {@code 500}. Building the Price is the last step and it throws an unchecked
	 * exception, so a rhythm Stripe has no word for used to be discovered <em>after</em> an earlier rhythm's
	 * Price had been created and tagged — leaving a real Price in Stripe that the {@code price.created}
	 * webhook adopts into a draft tier, under the very code the operator's retry is then refused for. Refused
	 * at construction, it never reaches Stripe at all.
	 *
	 * <p><strong>This narrows what may be <em>created</em>, not what may be adopted.</strong> A Price made in
	 * the Stripe dashboard is filed under whatever recurrence Stripe reports, through {@code TaggedPrice},
	 * which is untouched — so no catalog this code could not have made becomes unreadable.
	 */
	private static final Set<String> STRIPE_BILLS_BY = Set.of("day", "week", "month", "year");

	public PlanRhythm {
		if (amount < 0) {
			throw new IllegalArgumentException("A plan cannot cost less than nothing: " + amount);
		}
		if (interval == null || interval.isBlank()) {
			throw new IllegalArgumentException("A subscription plan has to recur; a one-off is not one");
		}
		interval = interval.strip().toLowerCase();
		if (!STRIPE_BILLS_BY.contains(interval)) {
			throw new IllegalArgumentException("Stripe bills by day, week, month or year, not by " + interval);
		}
	}

}
