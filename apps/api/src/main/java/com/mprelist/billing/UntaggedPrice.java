package com.mprelist.billing;

/**
 * A Stripe Price that names no tier (T53, #84).
 *
 * <p><strong>It exists because the failure it reports is silent.</strong> ADR-0019 makes
 * {@code metadata.tier_code} the whole of how a Price becomes a plan here, and names the cost of that in its
 * own consequences: "a missing tag is silent — the Price exists, nothing appears in {@code /admin}, and the
 * only symptom is absence". An operator who forgot the tag sees a plan they created and a plan screen that
 * does not have it, with nothing anywhere saying why. This is that nothing, given a name and a list.
 *
 * <p><strong>Not every one of these is a mistake</strong>, which is why the list is shown rather than acted
 * on. Stripe accounts hold Prices for one-offs, coupons and experiments, and adopting them all is exactly
 * what ADR-0019 refuses to do. The operator is the one who can tell an experiment from a forgotten tag, so
 * what they are handed is enough to recognise a Price by.
 *
 * @param id Stripe's id for it — what to search for in the dashboard, and the only field here that is certain
 * @param nickname what Stripe calls it, or {@code null}: a Price's nickname is optional and usually unset
 * @param amount in the currency's smallest unit, as Stripe counts it
 * @param currency ISO 4217, lower case, as Stripe writes it
 * @param interval how often it recurs, or {@code null} for a one-off — which is the field that most often
 * says "this was never going to be a plan", since a subscription tier has to recur
 */
public record UntaggedPrice(String id, String nickname, long amount, String currency, String interval) {

	public UntaggedPrice {
		if (id == null || id.isBlank()) {
			throw new IllegalArgumentException("A Price with no id is one nobody could go and find");
		}
		if (currency == null || currency.isBlank()) {
			throw new IllegalArgumentException("A price needs a currency to mean anything");
		}
		// Blank and absent are the same thing said twice, and only one of them can be rendered once.
		if (nickname != null && nickname.isBlank()) {
			nickname = null;
		}
		if (interval != null && interval.isBlank()) {
			interval = null;
		}
	}

}
