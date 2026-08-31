package com.mprelist.billing.internal;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.stripe.StripeClient;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * What the plan screen is allowed to say a buyer can pay with (T65, #137).
 *
 * <p><strong>A stub over the wire rather than a mocked SDK</strong>, for
 * {@code StripePriceCacheTest}'s reason and more sharply here: what is at risk is a <em>shape</em>. A method
 * is a field carrying {@code display_preference.value == "on"}, sitting among fields that are not methods at
 * all ({@code id}, {@code active}, {@code name}) and methods that are turned off — and a mocked SDK call would
 * assert that our own mock was called while every one of those readings was upside down. So this serves
 * Stripe's own JSON and points the real client at it.
 */
class PaymentMethodCacheTest {

	private static final Duration REMEMBERED = Duration.ofMinutes(15);

	private HttpServer stripe;

	/** What the stub serves. Null means Stripe answers 500. */
	private String served;

	private final AtomicInteger asked = new AtomicInteger();

	/** The clock the cache reads, so an entry can be aged without sleeping through a TTL. */
	private Instant now = Instant.parse("2026-09-01T09:00:00Z");

	@BeforeEach
	void startStripe() throws IOException {
		this.stripe = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
		this.stripe.createContext("/v1/payment_method_configurations", exchange -> {
			this.asked.incrementAndGet();
			respond(exchange, this.served == null ? 500 : 200,
					this.served == null ? "{\"error\":{\"message\":\"no\"}}" : this.served);
		});
		this.stripe.start();
		this.served = list(configuration("pmc_default", true, "Default",
				on("ideal"), on("paypal"), on("card"), off("sepa_debit"), off("klarna")));
	}

	@AfterEach
	void stopStripe() {
		this.stripe.stop(0);
	}

	@Test
	void aMethodIsOneTheDashboardHasTurnedOn() {
		// The whole reading, and every part of it is easy to get wrong invisibly: the token is the field's own
		// name, "on" lives two levels down under `display_preference`, and a method that is off is not offered
		// however present its field is.
		assertThat(methods().offered()).containsExactly("ideal", "paypal", "card");
	}

	/**
	 * {@code id}, {@code active}, {@code name}, {@code is_default} and {@code livemode} share the object with
	 * the methods, and the reading tells them apart by shape rather than by a list of names it would have to
	 * keep — which is the same thing that makes it survive Stripe adding a method nobody here has heard of.
	 */
	@Test
	void andTheFieldsThatAreNotMethodsAreNotMistakenForThem() {
		assertThat(methods().offered()).doesNotContain("id", "active", "name", "is_default", "livemode",
				"object");
	}

	/**
	 * A method this application has never heard of is still reported. Deciding what can be *named* is the
	 * popup's (`waysToPay`), and a filter here would put that vocabulary in two places — this one silently.
	 */
	@Test
	void aMethodNobodyHasHeardOfIsReportedRatherThanDropped() {
		this.served = list(configuration("pmc_default", true, "Default", on("ideal"), on("twint")));

		assertThat(methods().offered()).containsExactly("ideal", "twint");
	}

	/**
	 * The <em>default</em> configuration, because {@link OpenCheckout} sets no {@code payment_method_configuration}
	 * and Stripe therefore applies that one. An account may hold a second with a different set — for one-off
	 * payments, say — and reading it would advertise methods this product's Checkout never renders.
	 */
	@Test
	void andItIsTheDefaultConfigurationThatIsRead() {
		this.served = list(configuration("pmc_one_off", false, "One-off", on("klarna")),
				configuration("pmc_default", true, "Default", on("ideal")));

		assertThat(methods().offered()).containsExactly("ideal");
	}

	@Test
	void aStripeWithNoDefaultConfigurationSaysNothingRatherThanGuessing() {
		this.served = list(configuration("pmc_one_off", false, "One-off", on("klarna")));

		assertThat(methods().offered()).isEmpty();
	}

	@Test
	void andSoDoesOneThatCouldNotBeAskedAtAll() {
		this.served = null;

		assertThat(methods().offered()).isEmpty();
	}

	@Test
	void whichIsAlsoWhatAnAccountWithEverythingTurnedOffAnswers() {
		// Deliberately the same answer as an outage. Both mean "say nothing", the client has no third thing to
		// do, and the difference is in the log where an operator is rather than in a contract nobody can act
		// on differently.
		this.served = list(configuration("pmc_default", true, "Default", off("ideal"), off("card")));

		assertThat(methods().offered()).isEmpty();
	}

	@Test
	void andIsAskedForOnceHoweverOftenThePlanScreenIsOpened() {
		CachedPaymentMethods methods = methods();

		methods.offered();
		methods.offered();
		methods.offered();

		assertThat(this.asked).hasValue(1);
	}

	/**
	 * <strong>Unlike a Price, a configuration is mutable in place</strong> — an operator ticks PayPal and the
	 * same object now says something else. So this TTL is real freshness work rather than the bound on a
	 * mistake {@code price-cache} is, and it is why a newly enabled method is not on the plan screen at once.
	 */
	@Test
	void untilItIsOldEnoughToHaveChangedInTheDashboard() {
		CachedPaymentMethods methods = methods();
		assertThat(methods.offered()).containsExactly("ideal", "paypal", "card");

		this.served = list(configuration("pmc_default", true, "Default", on("ideal"), on("paypal"),
				on("card"), on("sepa_debit")));
		this.now = this.now.plus(REMEMBERED).plusSeconds(1);

		assertThat(methods.offered()).containsExactly("ideal", "paypal", "card", "sepa_debit");
		assertThat(this.asked).hasValue(2);
	}

	/**
	 * A failure is not remembered, the rule {@code CachedStripePrices} keeps: caching the absence would keep
	 * the sentence off the plan screen for a whole TTL after Stripe came back.
	 */
	@Test
	void aStripeThatCouldNotAnswerIsAskedAgainImmediately() {
		this.served = null;
		CachedPaymentMethods methods = methods();

		assertThat(methods.offered()).isEmpty();
		assertThat(methods.offered()).isEmpty();

		assertThat(this.asked).hasValue(2);
	}

	@Test
	void withNoApiKeyStripeIsNotEvenAsked() {
		CachedPaymentMethods unconfigured = new CachedPaymentMethods(new StripeAccount(""), REMEMBERED,
				() -> this.now);

		assertThat(unconfigured.offered()).isEmpty();
		assertThat(this.asked).hasValue(0);
	}

	// --- the stub, and the client pointed at it -----------------------------------------------------------

	private CachedPaymentMethods methods() {
		StripeClient client = StripeClient.builder()
				.setApiKey("sk_test_not_a_real_key")
				.setApiBase("http://localhost:" + this.stripe.getAddress().getPort())
				// One try, so a test about "asked once" is not counting the client's own retries.
				.setMaxNetworkRetries(0)
				.build();
		return new CachedPaymentMethods(new StripeAccount(client), REMEMBERED, () -> this.now);
	}

	private static String list(String... configurations) {
		return "{\"object\":\"list\",\"url\":\"/v1/payment_method_configurations\",\"has_more\":false,"
				+ "\"data\":[" + String.join(",", configurations) + "]}";
	}

	/** One configuration, shaped as Stripe writes it — non-method fields and all. */
	private static String configuration(String id, boolean isDefault, String name, String... methods) {
		return "{\"id\":\"" + id + "\",\"object\":\"payment_method_configuration\",\"active\":true,"
				+ "\"is_default\":" + isDefault + ",\"livemode\":false,\"name\":\"" + name + "\","
				+ String.join(",", methods) + "}";
	}

	private static String on(String method) {
		return preference(method, "on");
	}

	private static String off(String method) {
		return preference(method, "off");
	}

	private static String preference(String method, String value) {
		return "\"" + method + "\":{\"available\":true,\"display_preference\":{\"overridable\":null,"
				+ "\"preference\":\"" + value + "\",\"value\":\"" + value + "\"}}";
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
