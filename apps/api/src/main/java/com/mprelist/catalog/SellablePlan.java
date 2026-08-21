package com.mprelist.catalog;

/**
 * A tier somebody could buy: what it is called, what it grants, and the Stripe Price that sells it
 * (T49, #80).
 *
 * <p><strong>Half a plan, and deliberately.</strong> What it costs is not here and never will be — ADR-0014
 * splits money from limits and this module owns the limits, so the amount is fetched from Stripe by
 * {@code billing} and joined on {@link #stripePriceId()} at the one place that renders both. A record here
 * carrying a price in euros would be the second copy of a number Stripe owns, and the first thing to go
 * stale.
 *
 * <p>Every one of these is <em>published</em> and carries a price id, because those are the two halves of
 * "sellable" (ADR-0019): a draft synced at quota 0 before anyone said what it grants is not something to
 * offer, and neither is a tier with nothing to charge against. The free tier is therefore never one of these.
 */
public record SellablePlan(TierName tier, String stripePriceId, Entitlement grants) {

	public SellablePlan {
		if (tier == null || stripePriceId == null || stripePriceId.isBlank() || grants == null) {
			throw new IllegalArgumentException("A sellable plan needs a name, a price to charge and a grant");
		}
	}

}
