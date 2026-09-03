package com.mprelist.billing;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * A plan an operator has asked for, as Stripe needs it (on #84's screen).
 *
 * <p><strong>The tier code travels with it and becomes the tag</strong>, which is the whole reason this can
 * exist without breaking ADR-0019: each Price is created carrying {@code metadata.tier_code}, so the sync that
 * already runs adopts it exactly as it adopts one made by hand in the dashboard. Nothing new writes the
 * {@code tier} table.
 *
 * <p><strong>A plan, not a price</strong> (T66). It carries every rhythm it is to be sold at, because monthly
 * and annual Pro are one plan a buyer picks a rhythm for — one Product with a Price each — rather than two
 * acts an operator has to remember to perform in sequence.
 *
 * @param tierCode the stable handle ADR-0014 makes the thing anything references, and the tag on the Prices
 * @param name what to call the Product in Stripe, and what the tier will be called
 * @param currency lower case as Stripe writes it, and one the account can actually settle in — which is what
 * {@link StripeAccountFacts#sellableCurrencies()} exists to keep an operator inside. One for the whole plan,
 * like the whole catalog (T63, #129): a plan whose annual price was in another currency is not a comparison
 * a buyer could make
 * @param rhythms what it costs, per rhythm, at least one and never two of the same. A duplicate rhythm is not
 * a plan sold two ways but two answers to one question — and, adopted, the second would silently replace the
 * first, so it is refused where it is said rather than where it lands
 */
public record NewPlanInStripe(String tierCode, String name, String currency, List<PlanRhythm> rhythms) {

	public NewPlanInStripe {
		if (tierCode == null || tierCode.isBlank()) {
			throw new IllegalArgumentException("A plan with no tier code is a Price the sync would ignore");
		}
		if (name == null || name.isBlank()) {
			throw new IllegalArgumentException("A plan needs a name; it is what an operator finds it by");
		}
		if (currency == null || currency.isBlank()) {
			throw new IllegalArgumentException("A price needs a currency to mean anything");
		}
		if (rhythms == null || rhythms.isEmpty()) {
			throw new IllegalArgumentException("A plan nobody can be charged for is not one; state what it "
					+ "costs and how often");
		}
		Set<String> rhythmsSold = new LinkedHashSet<>();
		for (PlanRhythm rhythm : rhythms) {
			if (rhythm == null || !rhythmsSold.add(rhythm.interval())) {
				throw new IllegalArgumentException("A plan is sold at each rhythm once, and this one names "
						+ "the same one twice: " + rhythms);
			}
		}
		tierCode = tierCode.strip();
		name = name.strip();
		currency = currency.strip().toLowerCase();
		rhythms = List.copyOf(rhythms);
	}

}
