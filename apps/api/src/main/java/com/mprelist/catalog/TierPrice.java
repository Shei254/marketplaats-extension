package com.mprelist.catalog;

/**
 * One of the Stripe Prices a tier is sold at (T62, #128).
 *
 * <p><strong>A tier may have more than one, and that is the whole of this ticket.</strong> Monthly and annual
 * Pro are one plan a buyer chooses a rhythm for, not two plans — which ADR-0019 could not express, because
 * {@code tier.stripe_price_id} was single-valued and unique, and which it named as the first thing to move.
 *
 * <p><strong>The amount is still not here.</strong> ADR-0014's split holds: what a plan costs is Stripe's and
 * is fetched by {@code billing}, joined on this id at the one place that renders both. What this carries is
 * the id and which rhythm it is — because "the annual one" is the only handle a buyer or an operator ever uses
 * to mean one of a tier's prices, so a row has to be keyed on something and that is it.
 *
 * @param stripePriceId Stripe's id, which is what a Checkout session is opened with
 * @param interval how often it recurs, in Stripe's vocabulary — {@code day}, {@code week}, {@code month} or
 * {@code year}. Read off the Price when it was adopted rather than inferred, since a tier with two of these
 * is told apart by nothing else
 */
public record TierPrice(String stripePriceId, String interval) {

	public TierPrice {
		if (stripePriceId == null || stripePriceId.isBlank()) {
			throw new IllegalArgumentException("A price with no id is nothing a Checkout session could name");
		}
		if (interval == null || interval.isBlank()) {
			throw new IllegalArgumentException("A tier's price is told from its others by its interval, so a "
					+ "price without one is a price nothing could ask for");
		}
	}

}
