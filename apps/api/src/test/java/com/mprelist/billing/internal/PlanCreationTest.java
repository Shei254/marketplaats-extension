package com.mprelist.billing.internal;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.mprelist.billing.NewPlanInStripe;
import com.mprelist.billing.PlanCreation;
import com.mprelist.billing.PlanRhythm;
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

	private static final NewPlanInStripe PRO = new NewPlanInStripe("pro", "Pro", "eur",
			List.of(new PlanRhythm(999, "month")));

	/** The shape T66 is about: one plan, one Product, and a price per rhythm somebody may buy it at. */
	private static final NewPlanInStripe PRO_BOTH_WAYS = new NewPlanInStripe("pro", "Pro", "eur",
			List.of(new PlanRhythm(999, "month"), new PlanRhythm(9900, "year")));

	/** What {@code AccountCurrencies} hardcodes, mirrored here because the test has to outlive it. */
	private static final Duration FOR_A_DAY = Duration.ofDays(1);

	private HttpServer stripe;

	/** Every request Stripe was sent: its path, its form and its idempotency key. */
	private final List<Sent> sent = new ArrayList<>();

	private record Sent(String path, Map<String, String> form, String idempotencyKey) {
	}

	private boolean stripeAgrees = true;

	/** Which Price creation to start refusing at, so a plan can be half-made the way Stripe can half-make one. */
	private int refusePricesFrom = Integer.MAX_VALUE;

	/** How many Prices Stripe has been asked for, which is what gives each answer a different id. */
	private int pricesAsked;

	private String settlesIn = "eur";

	/** The clock {@code AccountCurrencies} reads, so a day can pass without sleeping through one. */
	private Instant now = Instant.parse("2026-09-01T09:00:00Z");

	@BeforeEach
	void startStripe() throws IOException {
		this.stripe = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
		this.stripe.createContext("/v1/", exchange -> {
			String path = exchange.getRequestURI().getPath();
			this.sent.add(new Sent(path, formIn(new String(exchange.getRequestBody().readAllBytes(), UTF_8)),
					exchange.getRequestHeaders().getFirst("Idempotency-Key")));
			boolean price = path.endsWith("/prices");
			if (price) {
				this.pricesAsked++;
			}
			if (!this.stripeAgrees || (price && this.pricesAsked >= this.refusePricesFrom)) {
				respond(exchange, 400, "{\"error\":{\"message\":\"Amount must be at least 50 cents\"}}");
				return;
			}
			respond(exchange, 200, answerFor(path, this.settlesIn, this.pricesAsked));
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

		assertThat(made).isEqualTo(new PlanCreation.Created("pro", "Pro",
				List.of(new PlanCreation.CreatedPrice("price_made_1", "month"))));
		assertThat(paths()).containsExactly("/v1/products", "/v1/prices");
	}

	/**
	 * <strong>A plan sold monthly and annually is one Product and two Prices</strong> (T66), which is the
	 * whole of why the rhythms arrive together rather than one form submit each.
	 *
	 * <p>Two calls to this method would make two Products with the same name — one plan appearing twice in
	 * the Stripe dashboard, which is a thing an operator then has to know to ignore. The tier is made by the
	 * tag on the Prices either way, so nothing here would have been visibly broken; it would just have been
	 * untidy in somebody else's system, permanently.
	 */
	@Test
	void andAPlanSoldTwoWaysIsOneProductWithAPricePerRhythm() {
		PlanCreation made = plans().create(PRO_BOTH_WAYS, "a-key");

		assertThat(made).isEqualTo(new PlanCreation.Created("pro", "Pro", List.of(
				new PlanCreation.CreatedPrice("price_made_1", "month"),
				new PlanCreation.CreatedPrice("price_made_2", "year"))));
		assertThat(paths()).containsExactly("/v1/products", "/v1/prices", "/v1/prices");
	}

	/** Each with its own amount and its own recurrence, which is the pair a buyer is choosing between. */
	@Test
	void andEachRhythmCarriesItsOwnAmount() {
		plans().create(PRO_BOTH_WAYS, "a-key");

		assertThat(formsTo("/v1/prices")).extracting(form -> form.get("unit_amount") + "/"
				+ form.get("recurring[interval]")).containsExactly("999/month", "9900/year");
		assertThat(formsTo("/v1/prices")).allSatisfy(
				form -> assertThat(form).containsEntry("metadata[tier_code]", "pro"));
	}

	/**
	 * And both Prices are made against the Product the first one made, rather than each against its own.
	 *
	 * <p>Pinned separately from the call count above because it is the field that would still be wrong if
	 * somebody later made the loop create a Product per rhythm: the paths would read the same and only this
	 * would say so.
	 */
	@Test
	void andBothAgainstTheOneProduct() {
		plans().create(PRO_BOTH_WAYS, "a-key");

		assertThat(formsTo("/v1/prices")).allSatisfy(
				form -> assertThat(form).containsEntry("product", "prod_made"));
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
		plans().create(new NewPlanInStripe("power", "Power", "eur", List.of(new PlanRhythm(1999, "year"))),
				"a-key");

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
				.containsExactly("a-key:product", "a-key:price:month")
				.doesNotContainNull();
	}

	/**
	 * And a rhythm is in its own key, so the second Price is not a replay of the first's answer.
	 *
	 * <p>Stripe scopes a key to the request body and replays the first answer for a repeat, so two Prices
	 * under one key would come back as one Price twice — a plan that looked created and was sold at one
	 * rhythm, with the annual button charging the monthly amount.
	 */
	@Test
	void andEachRhythmIsIdempotentUnderItsOwnKey() {
		plans().create(PRO_BOTH_WAYS, "a-key");

		assertThat(this.sent).extracting(Sent::idempotencyKey)
				.containsExactly("a-key:product", "a-key:price:month", "a-key:price:year");
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

	/**
	 * <strong>A plan whose second rhythm Stripe would not make is still a plan</strong> (T66).
	 *
	 * <p>Two Prices are two calls and Stripe has no transaction spanning them, so the annual one can fail
	 * after the monthly one is already made and tagged. Refusing the lot would be a lie — the monthly Price
	 * exists, it carries the tag, and the sync is about to adopt it whatever this method returns — and the
	 * operator's retry would then be refused for a code that is taken.
	 *
	 * <p>So what was made is reported, the tier is created selling what it can, and the missing rhythm is
	 * added from the row's own Prices form, which is where Stripe's refusal for it can be read.
	 */
	@Test
	void andWhatWasMadeIsReportedWhenARhythmIsRefusedAfterOneLanded() {
		this.refusePricesFrom = 2;

		PlanCreation made = plans().create(PRO_BOTH_WAYS, "a-key");

		assertThat(made).isEqualTo(new PlanCreation.Created("pro", "Pro",
				List.of(new PlanCreation.CreatedPrice("price_made_1", "month"))));
	}

	/** But a plan with no Price at all is nothing to adopt, so that is the refusal it always was. */
	@Test
	void andAPlanWhoseEveryRhythmWasRefusedIsRefused() {
		this.refusePricesFrom = 1;

		assertThat(plans().create(PRO_BOTH_WAYS, "a-key"))
				.isEqualTo(new PlanCreation.Refused("Amount must be at least 50 cents"));
	}

	// --- what it is priced in (T63, #129) -----------------------------------------------------------------------

	/**
	 * One currency for the whole catalog: the account's own settlement currency, read from Stripe.
	 *
	 * <p>An earlier draft asked for the country and then the country spec, so an operator could pick from
	 * every currency the account *could* charge in. That was a choice per plan, and a choice per plan is a
	 * plan screen showing €9,99 beside $12.99 — which a buyer cannot compare without knowing today's rate.
	 */
	@Test
	void theCatalogIsPricedInWhatThisAccountSettlesIn() {
		assertThat(currencies().sellingCurrency()).contains("eur");
		assertThat(paths()).containsExactly("/v1/account");
	}

	@Test
	void andThatIsAskedOfStripeOnceRatherThanPerForm() {
		AccountCurrencies currencies = currencies();

		currencies.sellingCurrency();
		currencies.sellingCurrency();

		// A settlement currency is fixed when the account is opened.
		assertThat(paths()).containsExactly("/v1/account");
	}

	@Test
	void andAStripeThatCannotBeAskedOffersNothingRatherThanAGuess() {
		this.stripeAgrees = false;

		assertThat(currencies().sellingCurrency()).isEmpty();
	}

	/** And a failure is not remembered, or one outage would cost a day of nobody being able to create a plan. */
	@Test
	void andThatFailureIsNotRemembered() {
		AccountCurrencies currencies = currencies();
		this.stripeAgrees = false;
		currencies.sellingCurrency();

		this.stripeAgrees = true;

		assertThat(currencies.sellingCurrency()).isPresent();
	}

	/**
	 * <strong>And the day is a real one.</strong> Every case above lands inside the TTL, so until this one
	 * nothing here distinguished "remembered for a day" from "remembered forever" — the currency is read once
	 * at startup either way. Re-onboarding an account into another settlement currency is rare and is exactly
	 * when a plan created afterwards would be priced in the old one.
	 */
	@Test
	void andAfterADayItIsAskedAgain() {
		AccountCurrencies currencies = currencies();
		assertThat(currencies.sellingCurrency()).contains("eur");

		this.settlesIn = "gbp";
		this.now = this.now.plus(FOR_A_DAY).plusSeconds(1);

		assertThat(currencies.sellingCurrency()).contains("gbp");
		assertThat(paths()).containsExactly("/v1/account", "/v1/account");
	}

	/** An account Stripe has not finished onboarding names none, and there is nothing safe to guess. */
	@Test
	void andAnAccountWithNoSettlementCurrencyOffersNothing() {
		this.settlesIn = "";

		assertThat(currencies().sellingCurrency()).isEmpty();
	}

	// --- the stub ------------------------------------------------------------------------------------------------

	private CreateStripePlans plans() {
		return new CreateStripePlans(account());
	}

	private AccountCurrencies currencies() {
		return new AccountCurrencies(account(), FOR_A_DAY, () -> this.now);
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

	/** Every form sent to a path, in order — which is what a plan sold at two rhythms needs to be read by. */
	private List<Map<String, String>> formsTo(String path) {
		return this.sent.stream().filter(one -> one.path().equals(path)).map(Sent::form).toList();
	}

	private static String answerFor(String path, String settlesIn, int pricesAsked) {
		if (path.endsWith("/products")) {
			return "{\"id\":\"prod_made\",\"object\":\"product\"}";
		}
		if (path.endsWith("/prices")) {
			// A different id per call: a plan sold two ways is two Prices, and a test that could not tell
			// them apart could not see the second one being filed under the wrong rhythm.
			return "{\"id\":\"price_made_" + pricesAsked + "\",\"object\":\"price\"}";
		}
		return "{\"id\":\"acct_1\",\"object\":\"account\",\"country\":\"NL\",\"default_currency\":\""
				+ settlesIn + "\"}";
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
