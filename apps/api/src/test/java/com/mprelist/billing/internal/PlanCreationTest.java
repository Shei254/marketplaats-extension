package com.mprelist.billing.internal;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.mprelist.billing.NewPlanInStripe;
import com.mprelist.billing.PlanCreation;
import com.mprelist.billing.SellableCurrencies;
import com.stripe.StripeClient;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * What we send Stripe when an operator creates a plan, and what we offer them to create it in.
 *
 * <p>Against the bytes on a loopback socket rather than a mocked SDK, for {@code CheckoutSessionTest}'s
 * reason and one of its own: the field that decides whether any of this works is
 * {@code metadata[tier_code]}, because it is the whole of what makes the Price a plan the existing sync will
 * adopt. A Price created without it is one nothing here ever notices again — the exact silence ADR-0019 named
 * — and a mock would accept it missing.
 */
class PlanCreationTest {

	private static final NewPlanInStripe PRO = new NewPlanInStripe("pro", "Pro", 999, "eur", "month");

	private HttpServer stripe;

	/** Every request Stripe was sent: its path, its form and its idempotency key. */
	private final List<Sent> sent = new ArrayList<>();

	private record Sent(String path, Map<String, String> form, String idempotencyKey) {
	}

	private boolean stripeAgrees = true;

	private String country = "NL";

	@BeforeEach
	void startStripe() throws IOException {
		this.stripe = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
		this.stripe.createContext("/v1/", exchange -> {
			String path = exchange.getRequestURI().getPath();
			this.sent.add(new Sent(path, formIn(new String(exchange.getRequestBody().readAllBytes(), UTF_8)),
					exchange.getRequestHeaders().getFirst("Idempotency-Key")));
			if (!this.stripeAgrees) {
				respond(exchange, 400, "{\"error\":{\"message\":\"Amount must be at least 50 cents\"}}");
				return;
			}
			respond(exchange, 200, answerFor(path, this.country));
		});
		this.stripe.start();
	}

	@AfterEach
	void stopStripe() {
		this.stripe.stop(0);
	}

	// --- creating the plan ------------------------------------------------------------------------------------

	@Test
	void aPlanBecomesAProductAndARecurringPrice() {
		PlanCreation made = plans().create(PRO, "a-key");

		assertThat(made).isEqualTo(new PlanCreation.Created("price_made", "pro", "Pro"));
		assertThat(paths()).containsExactly("/v1/products", "/v1/prices");
	}

	/**
	 * And the Price carries the tag, which is the whole of why this is compatible with ADR-0019: it is what
	 * makes the Price indistinguishable from one created by hand, so the sync adopts it through the path that
	 * already exists and nothing new writes the tier table.
	 */
	@Test
	void andThePriceCarriesTheTagTheSyncAdoptsOn() {
		plans().create(PRO, "a-key");

		assertThat(formTo("/v1/prices")).containsEntry("metadata[tier_code]", "pro");
	}

	@Test
	void andTheAmountTheCurrencyAndHowOftenItRecurs() {
		plans().create(PRO, "a-key");

		assertThat(formTo("/v1/prices"))
				.containsEntry("unit_amount", "999")
				.containsEntry("currency", "eur")
				.containsEntry("recurring[interval]", "month");
	}

	/** A one-off is not a subscription plan, so nothing here can make one: the recurrence is always sent. */
	@Test
	void andIsAlwaysRecurring() {
		plans().create(new NewPlanInStripe("power", "Power", 1999, "eur", "year"), "a-key");

		assertThat(formTo("/v1/prices")).containsEntry("recurring[interval]", "year");
	}

	/**
	 * Both calls carry an idempotency key, which is what makes a double-submitted form one plan.
	 *
	 * <p>Two keys derived from one, because Stripe scopes a key to the request body: the same key on both
	 * calls would make the Price creation replay the Product's answer.
	 */
	@Test
	void andBothCallsAreIdempotentOnTheCallersKey() {
		plans().create(PRO, "a-key");

		assertThat(this.sent).extracting(Sent::idempotencyKey)
				.containsExactly("a-key:product", "a-key:price")
				.doesNotContainNull();
	}

	@Test
	void aStripeThatRefusesSaysWhyInItsOwnWords() {
		// The text is the only thing that tells an operator what to change — a status could not say "at least
		// 50 cents" — which is why this one route answers a `problem` at all.
		this.stripeAgrees = false;

		assertThat(plans().create(PRO, "a-key"))
				.isEqualTo(new PlanCreation.Refused("Amount must be at least 50 cents"));
	}

	@Test
	void andAStripeNobodyConfiguredRefusesBeforeAskingAnything() {
		PlanCreation refused = new CreateStripePlans(new StripeAccount("")).create(PRO, "a-key");

		assertThat(refused).isInstanceOf(PlanCreation.Refused.class);
		assertThat(this.sent).isEmpty();
	}

	// --- what it may be priced in -------------------------------------------------------------------------------

	/**
	 * The currency list is what <em>this account</em> can settle in, read from Stripe: the account says which
	 * country it is in and the country spec says what may be charged there. A hardcoded list would offer a
	 * hundred and thirty, most of which would render a plan card and fail at Checkout.
	 */
	@Test
	void theCurrenciesOfferedAreTheOnesThisAccountCanSettleIn() {
		AccountCurrencies currencies = new AccountCurrencies(account());

		assertThat(currencies.sellableCurrencies())
				.contains(new SellableCurrencies("eur", List.of("eur", "usd", "gbp")));
		assertThat(paths()).containsExactly("/v1/account", "/v1/country_specs/NL");
	}

	@Test
	void andAreAskedOfStripeOnceRatherThanPerForm() {
		AccountCurrencies currencies = new AccountCurrencies(account());

		currencies.sellableCurrencies();
		currencies.sellableCurrencies();

		// A country spec changes when Stripe adds a currency to a country, which is years apart.
		assertThat(paths()).containsExactly("/v1/account", "/v1/country_specs/NL");
	}

	@Test
	void andAStripeThatCannotBeAskedOffersNothingRatherThanAGuess() {
		this.stripeAgrees = false;

		assertThat(new AccountCurrencies(account()).sellableCurrencies()).isEmpty();
	}

	/** And a failure is not remembered, or one outage would cost a day of nobody being able to create a plan. */
	@Test
	void andThatFailureIsNotRemembered() {
		AccountCurrencies currencies = new AccountCurrencies(account());
		this.stripeAgrees = false;
		currencies.sellableCurrencies();

		this.stripeAgrees = true;

		assertThat(currencies.sellableCurrencies()).isPresent();
	}

	/** An account Stripe has not finished onboarding has no country, so there is no list to offer. */
	@Test
	void andAnAccountWithNoCountryOffersNothing() {
		this.country = "";

		assertThat(new AccountCurrencies(account()).sellableCurrencies()).isEmpty();
	}

	// --- the stub ------------------------------------------------------------------------------------------------

	private CreateStripePlans plans() {
		return new CreateStripePlans(account());
	}

	private StripeAccount account() {
		return new StripeAccount(StripeClient.builder()
				.setApiKey("sk_test_not_a_real_key")
				.setApiBase("http://localhost:" + this.stripe.getAddress().getPort())
				.setMaxNetworkRetries(0)
				.build());
	}

	private List<String> paths() {
		return this.sent.stream().map(Sent::path).toList();
	}

	private Map<String, String> formTo(String path) {
		return this.sent.stream().filter(one -> one.path().equals(path)).findFirst()
				.orElseThrow(() -> new AssertionError("nothing was sent to " + path)).form();
	}

	private static String answerFor(String path, String country) {
		if (path.endsWith("/products")) {
			return "{\"id\":\"prod_made\",\"object\":\"product\"}";
		}
		if (path.endsWith("/prices")) {
			return "{\"id\":\"price_made\",\"object\":\"price\"}";
		}
		if (path.contains("/country_specs/")) {
			return "{\"id\":\"NL\",\"object\":\"country_spec\",\"default_currency\":\"eur\","
					+ "\"supported_payment_currencies\":[\"eur\",\"usd\",\"gbp\"]}";
		}
		return "{\"id\":\"acct_1\",\"object\":\"account\",\"country\":\"" + country
				+ "\",\"default_currency\":\"eur\"}";
	}

	private static Map<String, String> formIn(String body) {
		Map<String, String> fields = new HashMap<>();
		for (String pair : body.split("&")) {
			int equals = pair.indexOf('=');
			if (equals > 0) {
				fields.put(URLDecoder.decode(pair.substring(0, equals), UTF_8),
						URLDecoder.decode(pair.substring(equals + 1), UTF_8));
			}
		}
		return fields;
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
