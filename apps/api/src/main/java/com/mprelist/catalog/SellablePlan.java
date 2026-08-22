package com.mprelist.catalog;

/**
 * A tier somebody could buy: what it is called, what it grants, and the Stripe Price that sells it
 * (T49, #80).
 *
 * <p><strong>Half a plan, and deliberately.</strong> What it costs is not here and never will be — ADR-0014
 * splits money from limits and this module owns the limits, so each amount is fetched from Stripe by
 * {@code billing} and joined on a {@link TierPrice}'s id at the one place that renders both. A record here
 * carrying a price in euros would be the second copy of a number Stripe owns, and the first thing to go
 * stale.
 *
 * <p><strong>Several prices, since T62 (#128).</strong> Monthly and annual Pro are one plan a buyer chooses a
 * rhythm for; a card shows the tier once and its prices beside each other. Never empty — a tier with nothing
 * to charge against cannot be published, which the schema now holds through a trigger rather than a check.
 *
 * <p>Every one of these is <em>published</em> and carries a price id, because those are the two halves of
 * "sellable" (ADR-0019): a draft synced at quota 0 before anyone said what it grants is not something to
 * offer, and neither is a tier with nothing to charge against. The free tier is therefore never one of these.
 */
public record SellablePlan(TierName tier, java.util.List<TierPrice> prices, Entitlement grants) {

	public SellablePlan {
		if (tier == null || grants == null) {
			throw new IllegalArgumentException("A sellable plan needs a name and a grant");
		}
		if (prices == null || prices.isEmpty()) {
			throw new IllegalArgumentException("A sellable plan needs something to charge against; a tier with "
					+ "no price cannot be published, which the schema enforces");
		}
		prices = java.util.List.copyOf(prices);
	}

}
