package com.mprelist.billing.internal;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.mprelist.billing.StripePrice;
import com.mprelist.billing.StripePrices;
import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.Price;

/**
 * Stripe's prices, asked once and remembered (T49, #80).
 *
 * <p><strong>Why a cache is safe here, and it is not the usual reason.</strong> Stripe Prices are
 * <em>immutable</em> (ADR-0019): €9.99 never becomes €11.99, a new Price is created and the tier repointed.
 * So a cached amount for a given id cannot go stale in the way cached money usually does — what changes is
 * <em>which</em> id a tier points at, and that comes from our own table on every request, uncached. The TTL
 * is therefore not about keeping a number true. It bounds how long a mistake — a Price archived, an id
 * repointed and re-pointed back — could go on being shown, and it is the reason this holds nothing for ever.
 *
 * <p><strong>Failures are not cached.</strong> A Stripe outage must cost a retry, not a TTL: caching the
 * absence would turn a five-second blip into fifteen minutes of "prices unavailable" for everybody.
 *
 * <p><strong>No API key configured is the same answer as Stripe being down</strong>, which is deliberate and
 * is what a developer's stack meets: the plan cards say "unavailable, retry" rather than rendering an
 * invented amount. Said once at startup, because the alternative is a screen that fails and a log that
 * mentions nothing.
 */
@Service
class CachedStripePrices implements StripePrices {

	/**
	 * {@code @Autowired} because there are two constructors and Spring will not guess: without it the context
	 * fails to start looking for a default one, which is a startup failure naming neither Stripe nor this
	 * class's actual problem.
	 */
	@Autowired
	CachedStripePrices(@Value("${mprelist.stripe.secret-key:}") String secretKey,
			@Value("${mprelist.stripe.price-cache}") Duration remembered) {
		this.remembered = remembered;
		this.now = Instant::now;
		this.stripe = secretKey == null || secretKey.isBlank() ? null
				: StripeClient.builder().setApiKey(secretKey.strip()).build();
		if (this.stripe == null) {
			LOG.warn("No Stripe API key is configured, so no price can be fetched and the plan cards will say "
					+ "so. Set MPRELIST_STRIPE_SECRET_KEY to the test-mode secret key.");
		}
		else {
			LOG.info("Stripe prices are fetched with the configured API key and remembered for {}", remembered);
		}
	}

	/**
	 * Package-private, for the suite that points this at a stub standing in for Stripe. There is no other way
	 * to exercise the real client: the alternative is a test that mocks the SDK and proves that our mock was
	 * called, which would pass with the field mapping upside down.
	 */
	CachedStripePrices(StripeClient stripe, Duration remembered, Supplier<Instant> now) {
		this.stripe = stripe;
		this.remembered = remembered;
		this.now = now;
	}

	@Override
	public Optional<StripePrice> of(String stripePriceId) {
		if (this.stripe == null || stripePriceId == null || stripePriceId.isBlank()) {
			return Optional.empty();
		}
		Remembered held = this.prices.get(stripePriceId);
		if (held != null && held.isFresh(this.now.get())) {
			return Optional.of(held.price());
		}
		Optional<StripePrice> fetched = fetch(stripePriceId);
		// Only what came back. A Stripe outage must cost a retry, not a TTL: remembering the absence would
		// turn a five-second blip into fifteen minutes of "prices unavailable" for everybody.
		fetched.ifPresent(price -> this.prices.put(stripePriceId,
				new Remembered(price, this.now.get().plus(this.remembered))));
		return fetched;
	}

	/**
	 * One retrieve, and everything that can go wrong with it is the same answer.
	 *
	 * <p>A Price with no {@code recurring} block is a one-off — Stripe Prices get created for those, and one
	 * cannot be sold as a subscription. It is empty rather than an error for the same reason a missing id is:
	 * the caller's question is "can this be rendered as a plan", and the answer is no.
	 */
	private Optional<StripePrice> fetch(String stripePriceId) {
		try {
			Price price = this.stripe.prices().retrieve(stripePriceId);
			if (price.getUnitAmount() == null || price.getRecurring() == null
					|| price.getRecurring().getInterval() == null) {
				LOG.warn("Stripe Price {} is not something that can be sold as a plan: no amount, or no "
						+ "recurrence", stripePriceId);
				return Optional.empty();
			}
			return Optional
					.of(new StripePrice(price.getUnitAmount(), price.getCurrency(), price.getRecurring().getInterval()));
		}
		catch (StripeException unavailable) {
			// The message, not the exception: it names the id and the status, which is what an operator reads,
			// and the stack is Stripe's own client rather than anything of ours.
			LOG.warn("Could not fetch Stripe Price {}: {}", stripePriceId, unavailable.getMessage());
			return Optional.empty();
		}
	}

	/** One remembered answer and when it stops being one. */
	private record Remembered(StripePrice price, Instant until) {

		boolean isFresh(Instant now) {
			return now.isBefore(this.until);
		}

	}

	/**
	 * Unbounded, and it is bounded in practice by something better than a size limit: the keys are the price
	 * ids the tier catalog points at, which is a handful of rows an operator maintains by hand.
	 */
	private final Map<String, Remembered> prices = new ConcurrentHashMap<>();

	/** Null when no API key is configured, which is every developer's stack and is not an error. */
	private final StripeClient stripe;

	private final Duration remembered;

	/** The clock, so the suite can age an entry rather than sleep through one. */
	private final Supplier<Instant> now;

	private static final Logger LOG = LoggerFactory.getLogger(CachedStripePrices.class);

}
