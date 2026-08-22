package com.mprelist.billing.internal;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.mprelist.billing.UnadoptedPrices;
import com.mprelist.billing.UntaggedPrice;
import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.Price;
import com.stripe.param.PriceListParams;

/**
 * Asking Stripe what it holds that this catalog has never heard of (T53, #84).
 *
 * <p><strong>Uncached, deliberately</strong>, where its neighbour {@link CachedStripePrices} caches
 * everything. That one answers for a Price id our own table already holds, on a display path hit by every
 * plan screen, and its answer cannot go stale because Stripe Prices are immutable. This one is asked by one
 * operator, seconds after they created something in another browser tab, and the whole question is *what is
 * new*. A cache here would make the answer "not yet" to somebody whose next move is to reload.
 *
 * <p><strong>Active Prices only, and at most a hundred.</strong> An archived Price is not something anybody is
 * about to turn into a tier, and a hundred is Stripe's own page limit — an account holding more untagged
 * active Prices than that has a bigger problem than this screen, and paging a list nobody scrolls would be
 * machinery for a case that does not exist. The cap is stated here rather than discovered, so a list that
 * looks short is a list somebody can check.
 */
@Service
class UnadoptedStripePrices implements UnadoptedPrices {

	UnadoptedStripePrices(StripeAccount stripe) {
		this.stripe = stripe;
	}

	@Override
	public Optional<List<UntaggedPrice>> untagged() {
		Optional<StripeClient> client = this.stripe.client();
		if (client.isEmpty()) {
			// The same answer as an unreachable Stripe, which is what an unconfigured key amounts to
			// everywhere else in this module. It is said once at startup rather than on every call.
			return Optional.empty();
		}
		try {
			List<UntaggedPrice> untagged = new ArrayList<>();
			for (Price price : client.get().prices().list(EVERY_ACTIVE_PRICE).getData()) {
				if (tagged(price)) {
					continue;
				}
				untagged.add(new UntaggedPrice(price.getId(), price.getNickname(),
						price.getUnitAmount() == null ? 0L : price.getUnitAmount(), price.getCurrency(),
						price.getRecurring() == null ? null : price.getRecurring().getInterval()));
			}
			return Optional.of(List.copyOf(untagged));
		}
		catch (StripeException unavailable) {
			// The message, not the exception: it names what Stripe reported, and the stack is their client's.
			LOG.warn("Could not list Stripe's Prices, so the unadopted ones cannot be shown: {}",
					unavailable.getMessage());
			return Optional.empty();
		}
	}

	/**
	 * Whether this Price names a tier at all.
	 *
	 * <p>Blank counts as absent, for the reason {@code StripeEvent} reads it the same way: a metadata value
	 * somebody cleared in the dashboard is a tag that is not there, and treating the empty string as a code
	 * would hide the Price from this list while adopting nothing.
	 */
	private static boolean tagged(Price price) {
		Map<String, String> metadata = price.getMetadata();
		if (metadata == null) {
			return false;
		}
		String code = metadata.get(StripeEvent.TIER_CODE);
		return code != null && !code.isBlank();
	}

	private final StripeAccount stripe;

	/**
	 * A tier's Price is one somebody can still buy, so an archived one is not a candidate. Stripe's own
	 * ordering is newest first, which is the order an operator who has just created one wants to read.
	 */
	private static final PriceListParams EVERY_ACTIVE_PRICE = PriceListParams.builder()
			.setActive(true)
			.setLimit(100L)
			.build();

	private static final Logger LOG = LoggerFactory.getLogger(UnadoptedStripePrices.class);

}
