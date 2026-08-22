package com.mprelist.billing;

/**
 * A plan an operator has asked for, as Stripe needs it (on #84's screen).
 *
 * <p><strong>The tier code travels with it and becomes the tag</strong>, which is the whole reason this can
 * exist without breaking ADR-0019: the Price is created carrying {@code metadata.tier_code}, so the sync that
 * already runs adopts it exactly as it adopts one made by hand in the dashboard. Nothing new writes the
 * {@code tier} table.
 *
 * @param tierCode the stable handle ADR-0014 makes the thing anything references, and the tag on the Price
 * @param name what to call the Product in Stripe, and what the tier will be called
 * @param amount in the currency's smallest unit, as Stripe counts it — 999 is €9.99. **Zero is allowed**: a
 * free-of-charge recurring Price is a thing Stripe holds, and refusing it here would decide something this
 * type has no business deciding
 * @param currency lower case as Stripe writes it, and one the account can actually settle in — which is what
 * {@link StripeAccountFacts#sellableCurrencies()} exists to keep an operator inside
 * @param interval how often it recurs, in Stripe's vocabulary
 */
public record NewPlanInStripe(String tierCode, String name, long amount, String currency, String interval) {

	public NewPlanInStripe {
		if (tierCode == null || tierCode.isBlank()) {
			throw new IllegalArgumentException("A plan with no tier code is a Price the sync would ignore");
		}
		if (name == null || name.isBlank()) {
			throw new IllegalArgumentException("A plan needs a name; it is what an operator finds it by");
		}
		if (amount < 0) {
			throw new IllegalArgumentException("A plan cannot cost less than nothing: " + amount);
		}
		if (currency == null || currency.isBlank()) {
			throw new IllegalArgumentException("A price needs a currency to mean anything");
		}
		if (interval == null || interval.isBlank()) {
			throw new IllegalArgumentException("A subscription plan has to recur; a one-off is not one");
		}
		tierCode = tierCode.strip();
		name = name.strip();
		currency = currency.strip().toLowerCase();
		interval = interval.strip().toLowerCase();
	}

}
