package com.mprelist.billing.internal;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

	AccountCurrencies(StripeAccount stripe) {
		this.stripe = stripe;
	}

	@Override
	public Optional<String> sellingCurrency() {
		Remembered<String> held = this.remembered;
		if (held != null && held.isFresh(Instant.now())) {
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
			this.remembered = new Remembered<>(currency, Instant.now().plus(FOR_A_DAY));
			return Optional.of(currency);
		}
		catch (StripeException unavailable) {
			// The message, not the exception: it names what Stripe reported and the stack is their client's.
			LOG.warn("Could not ask Stripe what this account settles in: {}", unavailable.getMessage());
			return Optional.empty();
		}
	}

	private final StripeAccount stripe;

	/** Written once and read many times; a stale read costs one extra call to Stripe. */
	private volatile Remembered<String> remembered;

	private static final Duration FOR_A_DAY = Duration.ofDays(1);

	private static final Logger LOG = LoggerFactory.getLogger(AccountCurrencies.class);

}
