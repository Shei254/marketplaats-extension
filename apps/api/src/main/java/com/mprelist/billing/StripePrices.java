package com.mprelist.billing;

import java.util.Optional;

/**
 * What Stripe says a Price costs (T49, #80).
 *
 * <p>This module is the only one that talks to Stripe (ADR-0014), so a caller that needs an amount asks here
 * and is handed three fields rather than a Stripe object — which is what keeps the SDK out of
 * {@code display}'s imports and out of {@code catalog}'s entirely.
 *
 * <p><strong>Empty means "Stripe could not tell us", and it is not the same as zero.</strong> Every caller has
 * to treat it as a failure to render rather than as a free plan: the contract's rule for this route is that a
 * price we could not fetch produces "prices unavailable, retry" and never a card whose button opens a
 * Checkout for an amount we guessed. An {@link Optional} rather than an exception because the caller's job is
 * to decide what an unanswerable price does to a whole page, and that decision is easier to read as a value.
 */
public interface StripePrices {

	/**
	 * @param stripePriceId the id a tier carries, which the webhook wrote (T51, #82)
	 * @return what it costs, or nothing at all — Stripe unreachable, no API key configured, an id it does not
	 * know, or a Price with no recurrence
	 */
	Optional<StripePrice> of(String stripePriceId);

}
