package com.mprelist.billing;

import java.util.List;
import java.util.Optional;

/**
 * The Prices in Stripe that no tier will ever be made from (T53, #84).
 *
 * <p>A port of its own rather than a method on {@link StripePrices}, because the two are asked for opposite
 * reasons and want opposite things. That one answers "what does this Price cost" on a display path, for an id
 * our own table already holds, and is cached — safe because Stripe Prices are immutable (ADR-0019). This one
 * answers "what is in Stripe that is not here yet", for an operator who has just created something and wants
 * to see it, so a cache would be the exact wrong thing: the first thing they would do is reload.
 *
 * <p>Only {@code billing} talks to Stripe (ADR-0014), so what crosses out of it is our own
 * {@link UntaggedPrice} and never an SDK type — which is what keeps the {@code admin} module's imports free
 * of Stripe just as {@code catalog}'s and {@code display}'s are.
 */
public interface UnadoptedPrices {

	/**
	 * Every active Price carrying no {@code tier_code}, newest first.
	 *
	 * <p><strong>An empty list and an unanswerable question are different things</strong>, and the
	 * {@link Optional} is which. An empty list is the good state — every Price in the account is tagged — and
	 * a screen that reported it as a failure would send an operator hunting for a fault that is not there.
	 * Nothing at all means Stripe could not be asked, which is the answer a retry can fix, and is the same
	 * convention {@link StripePrices} uses for one price.
	 *
	 * <p>Tagged Prices are absent whether or not a tier looks adopted, because a tag is enough: the sync
	 * creates a draft for a code nothing recognises (ADR-0019), so a tagged Price always has a row somewhere
	 * and belongs in the tier list rather than in this one.
	 *
	 * @return the untagged Prices, or nothing at all when Stripe could not be asked
	 */
	Optional<List<UntaggedPrice>> untagged();

}
