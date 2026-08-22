package com.mprelist.billing;

import java.util.Optional;

/**
 * What Stripe says about the account this application bills through.
 *
 * <p>One question today — which currencies a plan may be priced in — and a port of its own rather than a
 * method on {@link StripePrices}, because that one is about a Price and this is about the account. It is
 * asked by the operator screen when a form is drawn, and by nothing on any user's path.
 *
 * <p><strong>Cached, and for once not because it is hot.</strong> An account's country and the currencies its
 * country spec allows change approximately never, and asking Stripe twice per form render would be two round
 * trips for an answer that has been the same since the account was opened.
 */
public interface StripeAccountFacts {

	/**
	 * @return what this account may price in, or nothing at all when Stripe could not be asked — which
	 * includes no API key configured, and is the same convention {@link StripePrices} uses. A form that cannot
	 * find out has to say so rather than offer a guess, because the guess is a plan that cannot be bought
	 */
	Optional<SellableCurrencies> sellableCurrencies();

}
