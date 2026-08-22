package com.mprelist.billing.internal;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.mprelist.billing.SellableCurrencies;
import com.mprelist.billing.StripeAccountFacts;
import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.Account;
import com.stripe.model.CountrySpec;

/**
 * Asking Stripe what this account may price a plan in (on #84's screen).
 *
 * <p><strong>Two calls, because neither answers alone.</strong> The account says which country it is
 * registered in and what it settles in by default; the <em>country spec</em> for that country says which
 * currencies may be charged at all. A form built from the first would offer one option, and a form built from
 * a hardcoded list would offer a hundred and thirty — most of which this account cannot take.
 *
 * <p><strong>Cached for a day, and not for speed.</strong> A country spec changes when Stripe adds a currency
 * to a country, which is a thing that happens on the scale of years; the cache exists so that drawing a form
 * is not two round trips to Stripe every time. A day is short enough that nobody waits for a restart and long
 * enough that it is effectively never asked twice.
 *
 * <p><strong>Failures are not cached</strong>, like {@code CachedStripePrices}: an outage must cost a retry
 * rather than a day of an operator being unable to create a plan.
 */
@Service
class AccountCurrencies implements StripeAccountFacts {

	AccountCurrencies(StripeAccount stripe) {
		this.stripe = stripe;
	}

	@Override
	public Optional<SellableCurrencies> sellableCurrencies() {
		Remembered held = this.remembered;
		if (held != null && held.isStillGoodAt(Instant.now())) {
			return Optional.of(held.currencies());
		}
		Optional<StripeClient> client = this.stripe.client();
		if (client.isEmpty()) {
			return Optional.empty();
		}
		try {
			Account account = client.get().accounts().retrieveCurrent();
			String country = account.getCountry();
			if (country == null || country.isBlank()) {
				// An account with no country has no country spec to read, which is a Stripe account not far
				// enough through onboarding to sell anything.
				LOG.warn("Stripe names no country for this account, so no currency list can be offered");
				return Optional.empty();
			}
			CountrySpec spec = client.get().countrySpecs().retrieve(country);
			List<String> supported = spec.getSupportedPaymentCurrencies();
			if (supported == null || supported.isEmpty()) {
				LOG.warn("Stripe's country spec for {} lists no payment currency", country);
				return Optional.empty();
			}
			SellableCurrencies currencies = new SellableCurrencies(
					defaultOf(account, spec, supported), supported);
			this.remembered = new Remembered(currencies, Instant.now().plus(FOR_A_DAY));
			return Optional.of(currencies);
		}
		catch (StripeException unavailable) {
			// The message, not the exception: it names what Stripe reported and the stack is their client's.
			LOG.warn("Could not ask Stripe which currencies this account sells in: {}", unavailable.getMessage());
			return Optional.empty();
		}
	}

	/**
	 * The account's own default where it has one, the country's where it does not, and the first supported
	 * currency where neither says — in that order, because the account's answer is the most specific and the
	 * list is guaranteed non-empty by the check above.
	 *
	 * <p>It also has to be <em>in</em> the list, or the form would open on an option it does not contain: an
	 * account settling in a currency its own country spec will not take is not a state Stripe should produce,
	 * and falling back rather than trusting it costs one comparison.
	 */
	private static String defaultOf(Account account, CountrySpec spec, List<String> supported) {
		for (String candidate : List.of(orEmpty(account.getDefaultCurrency()), orEmpty(spec.getDefaultCurrency()))) {
			if (supported.contains(candidate)) {
				return candidate;
			}
		}
		return supported.get(0);
	}

	private static String orEmpty(String value) {
		return value == null ? "" : value;
	}

	private record Remembered(SellableCurrencies currencies, Instant until) {

		boolean isStillGoodAt(Instant now) {
			return now.isBefore(this.until);
		}

	}

	private final StripeAccount stripe;

	/** Written once and read many times; a stale read costs one extra pair of calls to Stripe. */
	private volatile Remembered remembered;

	private static final Duration FOR_A_DAY = Duration.ofDays(1);

	private static final Logger LOG = LoggerFactory.getLogger(AccountCurrencies.class);

}
