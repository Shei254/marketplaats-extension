package com.mprelist.billing.internal;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.function.Supplier;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.mprelist.billing.StripeAccountFacts;
import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.Account;

/**
 * Asking Stripe what this account settles in (T63, #129).
 *
 * <p><strong>One call, and one answer for the whole catalog.</strong> An earlier draft asked for the account's
 * country and then its country spec, so that an operator could pick from every currency the account *could*
 * charge in — which was a choice per plan, and a choice per plan is a plan screen showing €9,99 beside $12.99.
 * A buyer cannot compare those without knowing today's rate. So the question shrank to the account's own
 * settlement currency, which needs neither the country nor the spec.
 *
 * <p><strong>Cached for a day, and not for speed.</strong> A settlement currency is fixed when the account is
 * opened. The cache exists so that drawing a form is not a round trip to Stripe every time. Failures are not
 * cached, like {@code CachedStripePrices}: an outage must cost a retry rather than a day of an operator being
 * unable to create a plan.
 */
@Service
class AccountCurrencies implements StripeAccountFacts {

	/**
	 * {@code @Autowired} because there are two constructors and Spring will not guess, the reason
	 * {@link CachedStripePrices} gives: without it the context fails to start looking for a default one.
	 *
	 * <p>The day is passed rather than configured, unlike the two caches beside this one. Their TTLs are
	 * operational — one bounds how long a mistake is shown, the other is real staleness — and an operator has
	 * cause to move them. This one is neither: a settlement currency is fixed when the account is opened, so
	 * there is no value here anybody would tune, and a property nobody sets is a knob to keep working.
	 */
	@Autowired
	AccountCurrencies(StripeAccount stripe) {
		this(stripe, FOR_A_DAY, Instant::now);
	}

	/**
	 * Package-private, for the suite that ages this clock rather than sleeping through a day — the same seam
	 * {@link CachedStripePrices} and {@link CachedPaymentMethods} open, and for the same reason: a TTL no test
	 * can reach is a TTL nothing checks.
	 */
	AccountCurrencies(StripeAccount stripe, Duration remembered, Supplier<Instant> now) {
		this.stripe = stripe;
		this.remembered = remembered;
		this.now = now;
	}

	@Override
	public Optional<String> sellingCurrency() {
		Remembered<String> held = this.held;
		if (held != null && held.isFresh(this.now.get())) {
			return Optional.of(held.answer());
		}
		Optional<StripeClient> client = this.stripe.client();
		if (client.isEmpty()) {
			return Optional.empty();
		}
		try {
			Account account = client.get().accounts().retrieveCurrent();
			String currency = account.getDefaultCurrency();
			if (currency == null || currency.isBlank()) {
				// An account Stripe has not finished onboarding names no settlement currency, and there is
				// nothing to fall back to that would not be a guess about somebody's money.
				LOG.warn("Stripe names no settlement currency for this account, so no plan can be priced");
				return Optional.empty();
			}
			this.held = new Remembered<>(currency, this.now.get().plus(this.remembered));
			return Optional.of(currency);
		}
		catch (StripeException unavailable) {
			// The message, not the exception: it names what Stripe reported and the stack is their client's.
			LOG.warn("Could not ask Stripe what this account settles in: {}", unavailable.getMessage());
			return Optional.empty();
		}
	}

	private final StripeAccount stripe;

	private final Duration remembered;

	private final Supplier<Instant> now;

	/** Written once and read many times; a stale read costs one extra call to Stripe. */
	private volatile Remembered<String> held;

	private static final Duration FOR_A_DAY = Duration.ofDays(1);

	private static final Logger LOG = LoggerFactory.getLogger(AccountCurrencies.class);

}
