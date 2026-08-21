package com.mprelist.billing.internal;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.mprelist.billing.StripePrice;
import com.stripe.StripeClient;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * The one place in this repository that talks to something Stripe-shaped (T49, #80).
 *
 * <p><strong>A stub over the wire rather than a mocked SDK.</strong> What is actually at risk here is the
 * field mapping — {@code unit_amount} is not {@code amount}, the interval is nested under {@code recurring},
 * and a Price with no recurrence is not a plan — and a test that mocked {@code prices().retrieve} would
 * assert that our own mock was called and pass with every one of those upside down. So this serves Stripe's
 * JSON on a loopback port and points the real client at it, which is the same arrangement
 * {@code MintedTokens} has with Keycloak's JWKS.
 *
 * <p>It lives in the module's own package because {@code CachedStripePrices} is internal and should stay
 * that way — the same reason {@code RelistPaceTest} sits inside {@code enforcement.internal}.
 */
class StripePriceCacheTest {

	private static final Duration REMEMBERED = Duration.ofMinutes(15);

	private HttpServer stripe;

	/** What the stub serves, per price id. Absent means Stripe answers 500. */
	private final Map<String, String> served = new HashMap<>();

	private final AtomicInteger asked = new AtomicInteger();

	/** The clock the cache reads, so an entry can be aged without sleeping through a TTL. */
	private Instant now = Instant.parse("2026-08-21T09:00:00Z");

	@BeforeEach
	void startStripe() throws IOException {
		this.stripe = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
		this.stripe.createContext("/v1/prices/", exchange -> {
			this.asked.incrementAndGet();
			String id = exchange.getRequestURI().getPath().substring("/v1/prices/".length());
			String body = this.served.get(id);
			respond(exchange, body == null ? 500 : 200, body == null ? "{\"error\":{\"message\":\"no\"}}" : body);
		});
		this.stripe.start();
		this.served.put("price_pro", recurring(999, "eur", "month"));
	}

	@AfterEach
	void stopStripe() {
		this.stripe.stop(0);
	}

	@Test
	void aPriceIsTheThreeFieldsAPlanCardNeeds() {
		// Every one of these is a field it would be easy to get wrong and impossible to notice: `unit_amount`
		// is not `amount`, and the interval is nested a level down under `recurring`.
		assertThat(prices().of("price_pro")).contains(new StripePrice(999, "eur", "month"));
	}

	@Test
	void andIsAskedForOnceHoweverOftenItIsRendered() {
		// The popup opens as often as somebody clicks the toolbar. Stripe Prices are immutable (ADR-0019), so
		// asking again buys nothing but latency and a rate limit.
		CachedStripePrices prices = prices();

		prices.of("price_pro");
		prices.of("price_pro");
		prices.of("price_pro");

		assertThat(this.asked).hasValue(1);
	}

	@Test
	void untilWhatWasRememberedIsOldEnoughToAskAgain() {
		CachedStripePrices prices = prices();
		prices.of("price_pro");

		this.now = this.now.plus(REMEMBERED).plusSeconds(1);
		prices.of("price_pro");

		assertThat(this.asked).hasValue(2);
	}

	/**
	 * A failure is **not** remembered, and that is the asymmetry worth a test: caching the absence would turn
	 * a five-second Stripe blip into fifteen minutes of "prices unavailable" for everybody.
	 */
	@Test
	void aStripeThatCouldNotAnswerIsAskedAgainImmediately() {
		this.served.clear();
		CachedStripePrices prices = prices();

		assertThat(prices.of("price_pro")).isEmpty();
		assertThat(prices.of("price_pro")).isEmpty();

		assertThat(this.asked).hasValue(2);
	}

	@Test
	void andOnceItCanAnswerTheAnswerIsUsed() {
		CachedStripePrices prices = prices();
		this.served.clear();
		assertThat(prices.of("price_pro")).isEmpty();

		this.served.put("price_pro", recurring(999, "eur", "month"));

		assertThat(prices.of("price_pro")).contains(new StripePrice(999, "eur", "month"));
	}

	/**
	 * A Price with no recurrence is a one-off, and Stripe Prices get created for those — coupons,
	 * experiments, single charges. It is not something this product can sell as a plan, and empty is the same
	 * answer as an id Stripe has never heard of because the caller's question is the same: can this be
	 * rendered as a plan.
	 */
	@Test
	void aPriceThatDoesNotRecurIsNotAPlan() {
		this.served.put("price_one_off", "{\"id\":\"price_one_off\",\"object\":\"price\",\"unit_amount\":500,"
				+ "\"currency\":\"eur\"}");

		assertThat(prices().of("price_one_off")).isEmpty();
	}

	@Test
	void andNeitherIsOneWithNoAmountAtAll() {
		this.served.put("price_metered", "{\"id\":\"price_metered\",\"object\":\"price\",\"currency\":\"eur\","
				+ "\"recurring\":{\"interval\":\"month\"}}");

		assertThat(prices().of("price_metered")).isEmpty();
	}

	/**
	 * With no API key nothing is asked and nothing is answered — which is every developer's stack, and is why
	 * the plan cards say "unavailable, retry" there rather than rendering an invented amount.
	 */
	@Test
	void withNoApiKeyStripeIsNotEvenAsked() {
		CachedStripePrices unconfigured = new CachedStripePrices("", REMEMBERED);

		assertThat(unconfigured.of("price_pro")).isEmpty();
		assertThat(this.asked).hasValue(0);
	}

	@Test
	void andAnIdNobodyGaveIsNotAskedForEither() {
		assertThat(prices().of(null)).isEmpty();
		assertThat(prices().of(" ")).isEmpty();
		assertThat(this.asked).hasValue(0);
	}

	// --- the stub, and the client pointed at it -----------------------------------------------------------

	private CachedStripePrices prices() {
		StripeClient client = StripeClient.builder()
				.setApiKey("sk_test_not_a_real_key")
				.setApiBase("http://localhost:" + this.stripe.getAddress().getPort())
				// One try, so a test about "asked once" is not counting the client's own retries.
				.setMaxNetworkRetries(0)
				.build();
		return new CachedStripePrices(client, REMEMBERED, () -> this.now);
	}

	private static String recurring(long amount, String currency, String interval) {
		return "{\"id\":\"price_pro\",\"object\":\"price\",\"unit_amount\":" + amount + ",\"currency\":\""
				+ currency + "\",\"recurring\":{\"interval\":\"" + interval + "\",\"interval_count\":1}}";
	}

	private static void respond(HttpExchange exchange, int status, String body) throws IOException {
		byte[] bytes = body.getBytes(UTF_8);
		exchange.getResponseHeaders().add("Content-Type", "application/json");
		exchange.sendResponseHeaders(status, bytes.length);
		try (OutputStream out = exchange.getResponseBody()) {
			out.write(bytes);
		}
	}

}
