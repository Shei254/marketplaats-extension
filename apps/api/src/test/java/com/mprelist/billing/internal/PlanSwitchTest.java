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
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.mprelist.catalog.Entitlement;
import com.mprelist.catalog.FreeTierOnOffer;
import com.mprelist.catalog.SellablePlan;
import com.mprelist.catalog.TierCatalog;
import com.mprelist.catalog.TierId;
import com.mprelist.catalog.TierName;
import com.mprelist.catalog.TierPrice;
import com.mprelist.identity.UserRef;
import com.mprelist.subscription.Subscription;
import com.mprelist.subscription.Subscriptions;
import com.stripe.StripeClient;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * What we send Stripe when a subscriber switches plan, and what we make of its answers (T85, ADR-0036).
 *
 * <p>Against the bytes on the wire, for {@code CheckoutSessionTest}'s reason: the fields here decide whether a
 * switch is one subscription changed or a second one opened, and whether a downgrade is prorated or simply
 * lost — a mocked SDK would accept any of them missing.
 */
class PlanSwitchTest {

	private static final UserRef PAYER = new UserRef(UUID.fromString("11111111-2222-3333-4444-555555555555"));

	private static final SellablePlan PRO = new SellablePlan(new TierName("pro", "Pro"),
			List.of(new TierPrice("price_pro", "month"), new TierPrice("price_pro_yearly", "year")),
			new Entitlement(50, 1, Map.of()));

	private static final SellablePlan POWER = new SellablePlan(new TierName("power", "Power"),
			List.of(new TierPrice("price_power", "month")), new Entitlement(200, 1, Map.of()));

	private HttpServer stripe;

	/** Every request Stripe was sent, as method and path, in order. */
	private final List<String> asked = new ArrayList<>();

	/** The form each path was last posted, decoded. */
	private final Map<String, Map<String, String>> posted = new HashMap<>();

	private boolean stripeAnswers = true;

	/** Whether the update comes back waiting on the payer. */
	private boolean paymentNeedsThePayer = false;

	private long previewTotal = 743;

	@BeforeEach
	void startStripe() throws IOException {
		this.stripe = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
		this.stripe.createContext("/v1/", exchange -> {
			String path = exchange.getRequestURI().getPath();
			this.asked.add(exchange.getRequestMethod() + " " + path);
			if ("POST".equals(exchange.getRequestMethod())) {
				this.posted.put(path, formIn(new String(exchange.getRequestBody().readAllBytes(), UTF_8)));
			}
			if (!this.stripeAnswers) {
				respond(exchange, 500, "{\"error\":{\"message\":\"no\"}}");
				return;
			}
			switch (exchange.getRequestMethod() + " " + path) {
				case "GET /v1/subscriptions/sub_1" -> respond(exchange, 200, subscription("price_pro", false));
				case "POST /v1/subscriptions/sub_1" ->
					respond(exchange, 200, subscription("price_power", this.paymentNeedsThePayer));
				case "POST /v1/invoices/create_preview" -> respond(exchange, 200,
						"{\"object\":\"invoice\",\"total\":" + this.previewTotal + ",\"currency\":\"eur\"}");
				default -> respond(exchange, 404, "{\"error\":{\"message\":\"not faked\"}}");
			}
		});
		this.stripe.start();
	}

	@AfterEach
	void stopStripe() {
		this.stripe.stop(0);
	}

	// --- the switch ----------------------------------------------------------------------------------------

	@Test
	void aSwitchChangesThePriceOnTheSubscriptionTheyAlreadyHave() {
		PlanSwitch made = switches(true).apply(PAYER, "power", "month");

		assertThat(made).isEqualTo(new PlanSwitch.Switched());
		assertThat(this.posted.get("/v1/subscriptions/sub_1"))
				.containsEntry("items[0][id]", "si_1")
				.containsEntry("items[0][price]", "price_power");
	}

	/** The whole reason this exists: nothing here ever opens a second one (T83). */
	@Test
	void andNeverOpensASecondOne() {
		switches(true).apply(PAYER, "power", "month");

		assertThat(this.asked).noneMatch(call -> call.contains("checkout"));
		assertThat(this.asked).containsExactly("GET /v1/subscriptions/sub_1", "POST /v1/subscriptions/sub_1");
	}

	/**
	 * Prorated and invoiced now, both ways — an upgrade charged the difference, a downgrade credited — and held
	 * back until the money has moved, so a declined card leaves them on the plan they had.
	 */
	@Test
	void proratedNowAndAppliedOnlyOncePaid() {
		switches(true).apply(PAYER, "power", "month");

		assertThat(this.posted.get("/v1/subscriptions/sub_1"))
				.containsEntry("proration_behavior", "always_invoice")
				.containsEntry("payment_behavior", "pending_if_incomplete")
				.containsEntry("expand[0]", "latest_invoice");
	}

	/** 3-D Secure: nothing has moved, and the invoice's own page is where the payer finishes it. */
	@Test
	void aPaymentThatNeedsThePayerIsFinishedOnTheInvoicesPage() {
		this.paymentNeedsThePayer = true;

		assertThat(switches(true).apply(PAYER, "power", "month"))
				.isEqualTo(new PlanSwitch.ConfirmPayment("https://invoice.stripe.com/i/in_1"));
	}

	/** A second click, or a card drawn before the webhook landed: nothing to charge, and nothing is sent. */
	@Test
	void switchingToThePriceTheyAreAlreadyBilledAtChangesNothing() {
		assertThat(switches(true).apply(PAYER, "pro", "month")).isEqualTo(new PlanSwitch.Switched());
		assertThat(this.asked).containsExactly("GET /v1/subscriptions/sub_1");
	}

	@Test
	void theOtherRhythmOfTheSamePlanIsASwitchToo() {
		switches(true).apply(PAYER, "pro", "year");

		assertThat(this.posted.get("/v1/subscriptions/sub_1")).containsEntry("items[0][price]", "price_pro_yearly");
	}

	// --- the preview ---------------------------------------------------------------------------------------

	/** The same items and the same proration, asked of Stripe, so the dialog shows Stripe's number and not ours. */
	@Test
	void thePreviewIsStripesInvoiceForTheSameSwitch() {
		PlanSwitch previewed = switches(true).preview(PAYER, "power", "month");

		assertThat(previewed).isEqualTo(new PlanSwitch.Previewed(743, "eur"));
		assertThat(this.posted.get("/v1/invoices/create_preview"))
				.containsEntry("subscription", "sub_1")
				.containsEntry("subscription_details[items][0][id]", "si_1")
				.containsEntry("subscription_details[items][0][price]", "price_power")
				.containsEntry("subscription_details[proration_behavior]", "always_invoice");
	}

	@Test
	void andChangesNothing() {
		switches(true).preview(PAYER, "power", "month");

		assertThat(this.asked).doesNotContain("POST /v1/subscriptions/sub_1");
	}

	/** A downgrade: Stripe's total is negative, and that is the credit the customer is left with. */
	@Test
	void aDowngradePreviewsAsACredit() {
		this.previewTotal = -410;

		assertThat(switches(true).preview(PAYER, "power", "month")).isEqualTo(new PlanSwitch.Previewed(-410, "eur"));
	}

	// --- the refusals --------------------------------------------------------------------------------------

	/** Nothing to switch, and Stripe is not asked: Checkout is theirs. */
	@Test
	void somebodyStripeIsNotBillingIsNotPaying() {
		assertThat(switches(false).apply(PAYER, "power", "month")).isEqualTo(new PlanSwitch.NotPaying());
		assertThat(switches(false).preview(PAYER, "power", "month")).isEqualTo(new PlanSwitch.NotPaying());
		assertThat(this.asked).isEmpty();
	}

	@Test
	void aPlanOrRhythmNothingIsSoldAtIsNotForSale() {
		assertThat(switches(true).apply(PAYER, "starter", "month")).isEqualTo(new PlanSwitch.NotForSale());
		assertThat(switches(true).apply(PAYER, "power", "year")).isEqualTo(new PlanSwitch.NotForSale());
		assertThat(this.asked).isEmpty();
	}

	@Test
	void aStripeThatWillNotAnswerIsUnavailable() {
		this.stripeAnswers = false;

		assertThat(switches(true).apply(PAYER, "power", "month")).isEqualTo(new PlanSwitch.Unavailable());
		assertThat(switches(true).preview(PAYER, "power", "month")).isEqualTo(new PlanSwitch.Unavailable());
	}

	@Test
	void andSoIsAStripeNobodyConfigured() {
		SwitchPlans unconfigured = new SwitchPlans(catalogOf(List.of(PRO, POWER)), payer(true),
				new StripeAccount(""));

		assertThat(unconfigured.apply(PAYER, "power", "month")).isEqualTo(new PlanSwitch.Unavailable());
	}

	// --- the bodies ----------------------------------------------------------------------------------------

	@Test
	void aSwitchThatIsDoneSaysThereIsNothingToConfirm() {
		String body = tools.jackson.databind.json.JsonMapper.builder().build()
				.writeValueAsString(new StartPlanSwitch.SwitchMade(null));

		assertThat(body).isEqualTo("{\"confirmAt\":null}");
	}

	// --- the collaborators, by hand ------------------------------------------------------------------------

	private SwitchPlans switches(boolean paying) {
		return new SwitchPlans(catalogOf(List.of(PRO, POWER)), payer(paying), account());
	}

	private StripeAccount account() {
		return new StripeAccount(StripeClient.builder()
				.setApiKey("sk_test_not_a_real_key")
				.setApiBase("http://localhost:" + this.stripe.getAddress().getPort())
				.setMaxNetworkRetries(0)
				.build());
	}

	private static String subscription(String price, boolean pending) {
		return "{\"id\":\"sub_1\",\"object\":\"subscription\","
				+ "\"items\":{\"object\":\"list\",\"data\":[{\"id\":\"si_1\",\"object\":\"subscription_item\","
				+ "\"price\":{\"id\":\"" + price + "\",\"object\":\"price\"}}]},"
				+ "\"pending_update\":" + (pending ? "{\"expires_at\":1790000000}" : "null") + ","
				+ "\"latest_invoice\":{\"id\":\"in_1\",\"object\":\"invoice\","
				+ "\"hosted_invoice_url\":\"https://invoice.stripe.com/i/in_1\"}}";
	}

	/** Only `published()` is ever called. */
	private static TierCatalog catalogOf(List<SellablePlan> onSale) {
		return new TierCatalog() {

			@Override
			public Optional<TierId> defaultTier() {
				throw new UnsupportedOperationException("not part of switching plan");
			}

			@Override
			public Entitlement entitlementOf(TierId tier) {
				throw new UnsupportedOperationException("not part of switching plan");
			}

			@Override
			public TierName nameOf(TierId tier) {
				throw new UnsupportedOperationException("not part of switching plan");
			}

			@Override
			public List<SellablePlan> published() {
				return onSale;
			}

			@Override
			public Optional<FreeTierOnOffer> freeTierOnOffer() {
				throw new UnsupportedOperationException("the free tier is never switched to");
			}

			@Override
			public Optional<TierId> tierSoldAs(String stripePriceId) {
				throw new UnsupportedOperationException("that is the webhook's question");
			}

		};
	}

	private static Subscriptions payer(boolean paying) {
		return new Subscriptions() {

			@Override
			public Subscription currentFor(UserRef user) {
				throw new UnsupportedOperationException("a switch does not read the plan row");
			}

			@Override
			public Optional<String> stripeCustomerFor(UserRef user) {
				throw new UnsupportedOperationException("a switch names the subscription, not the customer");
			}

			@Override
			public Optional<String> stripeSubscriptionFor(UserRef user) {
				return paying ? Optional.of("sub_1") : Optional.empty();
			}

			@Override
			public Optional<String> stripePriceFor(UserRef user) {
				throw new UnsupportedOperationException("the current Price is read from Stripe, not the mirror");
			}

			@Override
			public boolean isPaying(UserRef user) {
				return paying;
			}

		};
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
