package com.mprelist.billing;

import java.util.List;

/**
 * What this Stripe account can actually take money in (T55-era admin work, on #84's screen).
 *
 * <p><strong>Read from Stripe rather than listed here, and that is the whole point of the type.</strong>
 * Stripe supports around a hundred and thirty currencies; this <em>account</em> supports the ones its country
 * spec allows, which is a shorter list and a different one for a Dutch entity than for an American one. A
 * dropdown built from the long list can offer a currency that renders a plan card and then fails at Checkout —
 * and a dropdown hardcoded anywhere goes stale the day Stripe adds one.
 *
 * <p>So the operator is offered what the account can settle in, asked of Stripe, the same way the sign-in
 * reads its URLs out of a discovery document rather than composing them.
 *
 * @param defaultCurrency what the account settles in unless told otherwise — the one to select first, since
 * it is right almost every time and wrong visibly rather than silently
 * @param supported every currency this account may price in, lower case as Stripe writes them, including the
 * default. Never empty: an account with no sellable currency could not sell anything
 */
public record SellableCurrencies(String defaultCurrency, List<String> supported) {

	public SellableCurrencies {
		if (defaultCurrency == null || defaultCurrency.isBlank()) {
			throw new IllegalArgumentException("An account settles in some currency; Stripe always names one");
		}
		if (supported == null || supported.isEmpty()) {
			throw new IllegalArgumentException("An account that can price in nothing could not sell anything");
		}
		supported = List.copyOf(supported);
	}

}
