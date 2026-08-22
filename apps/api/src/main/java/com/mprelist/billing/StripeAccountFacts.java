package com.mprelist.billing;

import java.util.Optional;

/**
 * What Stripe says about the account this application bills through.
 *
 * <p>One question, and it has one answer for the whole catalog: which currency plans are priced in. A port of
 * its own rather than a method on {@link StripePrices}, because that one is about a Price and this is about
 * the account. It is asked when a plan is created, and by nothing on any user's path.
 *
 * <p><strong>Cached, and for once not because it is hot.</strong> An account's settlement currency is fixed
 * when the account is opened; asking Stripe per form render would be a round trip for an answer that has
 * never changed.
 */
public interface StripeAccountFacts {

	/**
	 * The one currency this catalog prices in — the Stripe account's own settlement currency.
	 *
	 * <p><strong>One currency for every tier, deliberately.</strong> A plan screen is a comparison, and
	 * €9,99 against $12.99 is not one a buyer can make: they would have to know today's rate to tell which
	 * plan is dearer. So it is not a choice made per plan, and since it is not a choice it is not a field —
	 * nothing a client sends carries a currency, and there is no request that could produce a mixed catalog.
	 *
	 * <p>Read from Stripe rather than configured, because the account can only settle in what it settles in:
	 * a setting here would be a second answer beside Stripe's, and the first symptom of a disagreement is a
	 * Price that Stripe refuses to create.
	 *
	 * @return the currency, lower case as Stripe writes it, or nothing at all where Stripe could not be asked
	 * or has not finished onboarding the account — in which case no plan can be created, and the screen has to
	 * say so rather than guess
	 */
	Optional<String> sellingCurrency();

}
