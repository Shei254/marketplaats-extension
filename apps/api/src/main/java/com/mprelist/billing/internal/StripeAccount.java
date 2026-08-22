package com.mprelist.billing.internal;

import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.stripe.StripeClient;

/**
 * The Stripe account this application acts as, or nothing at all (T19, #29).
 *
 * <p>One client for every caller in this module — the price lookup {@code GET /api/plans} makes and the
 * Checkout session a buyer opens — rather than one each. Two would mean two connection pools, two places the
 * API key is read, and two startup lines saying whether it is configured; the third of those is the one that
 * matters, because "is Stripe set up here" is a question an operator asks once.
 *
 * <p><strong>Unconfigured is a state and not a failure.</strong> Every developer's stack has no Stripe key,
 * and an application that refused to start without one would make every unrelated change need a secret. So it
 * starts, says so once, and every route that needs Stripe answers as though Stripe were unreachable — which
 * is the same fail-closed answer and the same screen.
 */
@Component
class StripeAccount {

	/**
	 * {@code @Autowired} because there are two constructors and Spring will not guess between them: without it
	 * the context fails to start looking for a default one, and the message names neither Stripe nor the
	 * actual problem.
	 */
	@Autowired
	StripeAccount(@Value("${mprelist.stripe.secret-key:}") String secretKey) {
		this.client = secretKey == null || secretKey.isBlank() ? null
				: StripeClient.builder().setApiKey(secretKey.strip()).build();
		if (this.client == null) {
			LOG.warn("No Stripe API key is configured, so no price can be fetched and no Checkout session can "
					+ "be opened. Set MPRELIST_STRIPE_SECRET_KEY to the test-mode secret key.");
		}
		else {
			LOG.info("Stripe is configured; prices and Checkout sessions will be asked of it.");
		}
	}

	/** For the suites that point this at something Stripe-shaped on a loopback port. */
	StripeAccount(StripeClient client) {
		this.client = client;
	}

	/** @return the client, or nothing when no API key is configured */
	Optional<StripeClient> client() {
		return Optional.ofNullable(this.client);
	}

	private final StripeClient client;

	private static final Logger LOG = LoggerFactory.getLogger(StripeAccount.class);

}
