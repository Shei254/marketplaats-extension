package com.mprelist.billing.internal;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

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
 * switch is one subscription changed or a second one opened, whether it buys a fresh period or a prorated
 * one, and whether it waits for renewal — a mocked SDK would accept any of them missing.
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

	/** The query each GET carried, by path. */
	private final Map<String, String> queried = new HashMap<>();

	/** Whether the update comes back waiting on the payer. */
	private boolean paymentNeedsThePayer = false;

	/** The type of the subscription's own default payment method, or {@code null} for none. */
	private String subscriptionMethod = "card";

	/** The type of the customer's invoice default, or {@code null} for none. */
	private String customerMethod = null;

	private long previewTotal = 743;

	/** Stripe's status for the subscription as it is fetched. */
	private String status = "active";

	/** The schedule controlling the subscription, or {@code null} for none. */
	private String schedule = null;

	private static final long PERIOD_START = 1_794_000_000L;

	private static final long PERIOD_END = 1_796_592_000L;

	@BeforeEach
	void startStripe() throws IOException {
		this.stripe = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
		this.stripe.createContext("/v1/", exchange -> {
			String path = exchange.getRequestURI().getPath();
			this.asked.add(exchange.getRequestMethod() + " " + path);
			if ("GET".equals(exchange.getRequestMethod())) {
				this.queried.put(path, URLDecoder.decode(String.valueOf(exchange.getRequestURI().getRawQuery()), UTF_8));
			}
			if ("POST".equals(exchange.getRequestMethod())) {
				this.posted.put(path, formIn(new String(exchange.getRequestBody().readAllBytes(), UTF_8)));
			}
			if (!this.stripeAnswers) {
				respond(exchange, 500, "{\"error\":{\"message\":\"no\"}}");
				return;
			}
			switch (exchange.getRequestMethod() + " " + path) {
				case "GET /v1/subscriptions/sub_1" -> respond(exchange, 200,
						subscription("price_pro", false, this.status));
				case "POST /v1/subscription_schedules" -> respond(exchange, 200, schedule(false));
				case "POST /v1/subscription_schedules/sub_sched_new" -> respond(exchange, 200, schedule(true));
				case "POST /v1/subscription_schedules/sub_sched_old/release" -> respond(exchange, 200,
						"{\"id\":\"sub_sched_old\",\"object\":\"subscription_schedule\",\"status\":\"released\"}");
				case "POST /v1/subscriptions/sub_1" -> respond(exchange, 200, updated(this.posted.get(path)));
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
	 * A fresh period at the new plan's full price, with nothing credited, up or down (T90, ADR-0042) — and
	 * held back until the money has moved, so a declined card leaves them on the plan they had.
	 */
	@Test
	void aSwitchRestartsThePeriodAtTheFullPriceAndAppliesOnlyOncePaid() {
		switches(true).apply(PAYER, "power", "month");

		assertThat(this.posted.get("/v1/subscriptions/sub_1"))
				.containsEntry("billing_cycle_anchor", "now")
				.containsEntry("proration_behavior", "none")
				.containsEntry("payment_behavior", "pending_if_incomplete")
				.containsEntry("expand[0]", "latest_invoice");
	}

	/** At most one switch is pending, and one made now replaces it: the schedule is released first. */
	@Test
	void aSwitchNowReleasesAScheduledOneFirst() {
		this.schedule = "sub_sched_old";

		switches(true).apply(PAYER, "power", "month");

		assertThat(this.asked).containsExactly("GET /v1/subscriptions/sub_1",
				"POST /v1/subscription_schedules/sub_sched_old/release", "POST /v1/subscriptions/sub_1");
	}

	/** 3-D Secure: nothing has moved, and the invoice's own page is where the payer finishes it. */
	@Test
	void aPaymentThatNeedsThePayerIsFinishedOnTheInvoicesPage() {
		this.paymentNeedsThePayer = true;

		assertThat(switches(true).apply(PAYER, "power", "month"))
				.isEqualTo(new PlanSwitch.ConfirmPayment("https://invoice.stripe.com/i/in_1"));
	}

	// --- the payment methods Stripe cannot hold a switch for ---------------------------------------------------

	/**
	 * The client's bug: Stripe refuses {@code pending_if_incomplete} outright when the default method is a SEPA
	 * debit, so it is never sent for one. The switch happens now and the debit clears afterwards (ADR-0036,
	 * amended 2026-11-12).
	 */
	@Test
	void aSepaDebitSwitchesAtOnceAndIsCollectedAfterwards() {
		this.subscriptionMethod = "sepa_debit";

		assertThat(switches(true).apply(PAYER, "power", "month")).isEqualTo(new PlanSwitch.Switched());
		assertThat(this.posted.get("/v1/subscriptions/sub_1"))
				.containsEntry("payment_behavior", "allow_incomplete")
				.containsEntry("proration_behavior", "none");
	}

	/** Every bank debit, and the methods that are not bank debits but are just as absent from Stripe's list. */
	@ParameterizedTest
	@ValueSource(strings = { "bacs_debit", "au_becs_debit", "nz_bank_account", "acss_debit", "us_bank_account",
			"blik", "mb_way", "a_method_stripe_adds_next_year" })
	void soDoesEveryMethodNotOnStripesPendingUpdatesList(String type) {
		this.subscriptionMethod = type;

		switches(true).apply(PAYER, "power", "month");

		assertThat(this.posted.get("/v1/subscriptions/sub_1")).containsEntry("payment_behavior", "allow_incomplete");
	}

	@ParameterizedTest
	@ValueSource(strings = { "card", "link", "paypal", "klarna", "eps", "kakao_pay", "naver_pay", "pix" })
	void whileTheMethodsOnItStillWaitForTheMoney(String type) {
		this.subscriptionMethod = type;

		switches(true).apply(PAYER, "power", "month");

		assertThat(this.posted.get("/v1/subscriptions/sub_1"))
				.containsEntry("payment_behavior", "pending_if_incomplete");
	}

	/** Checkout often leaves the method on the customer rather than the subscription; that is the one charged. */
	@Test
	void theCustomersDefaultCountsWhenTheSubscriptionNamesNone() {
		this.subscriptionMethod = null;
		this.customerMethod = "sepa_debit";

		switches(true).apply(PAYER, "power", "month");

		assertThat(this.posted.get("/v1/subscriptions/sub_1")).containsEntry("payment_behavior", "allow_incomplete");
		assertThat(this.queried.get("/v1/subscriptions/sub_1"))
				.contains("expand[0]=default_payment_method")
				.contains("expand[1]=customer.invoice_settings.default_payment_method");
	}

	@Test
	void andTheSubscriptionsOwnWinsOverTheCustomers() {
		this.subscriptionMethod = "card";
		this.customerMethod = "sepa_debit";

		switches(true).apply(PAYER, "power", "month");

		assertThat(this.posted.get("/v1/subscriptions/sub_1"))
				.containsEntry("payment_behavior", "pending_if_incomplete");
	}

	/** Nothing to hold the switch for: Stripe could not wait on it either, and the invoice will say what is owed. */
	@Test
	void noMethodAtAllSwitchesAtOnce() {
		this.subscriptionMethod = null;
		this.customerMethod = null;

		switches(true).apply(PAYER, "power", "month");

		assertThat(this.posted.get("/v1/subscriptions/sub_1")).containsEntry("payment_behavior", "allow_incomplete");
	}

	/**
	 * A BLIK or MB Way payment waiting on the payer's phone: the plan has already moved and the subscription is
	 * {@code past_due}, so they are sent to the invoice's page just as 3-D Secure sends them.
	 */
	@Test
	void aChargeThatNeedsThePayerAfterTheSwitchIsFinishedOnTheInvoicesPage() {
		this.subscriptionMethod = "blik";
		this.paymentNeedsThePayer = true;

		assertThat(switches(true).apply(PAYER, "power", "month"))
				.isEqualTo(new PlanSwitch.ConfirmPayment("https://invoice.stripe.com/i/in_1"));
	}

	/** A downgrade, or a debit already on its way: the invoice is paid or processing and nothing is owed now. */
	@Test
	void aSwitchThatIsNotPastDueIsDone() {
		this.subscriptionMethod = "sepa_debit";

		assertThat(switches(true).apply(PAYER, "power", "month")).isEqualTo(new PlanSwitch.Switched());
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

	/** The same items, anchor and proration, asked of Stripe, so the dialog shows Stripe's number and not ours. */
	@Test
	void thePreviewIsStripesInvoiceForTheSameSwitch() {
		PlanSwitch previewed = switches(true).preview(PAYER, "power", "month");

		assertThat(previewed).isEqualTo(new PlanSwitch.Previewed(743, "eur", at(PERIOD_END)));
		assertThat(this.posted.get("/v1/invoices/create_preview"))
				.containsEntry("subscription", "sub_1")
				.containsEntry("subscription_details[items][0][id]", "si_1")
				.containsEntry("subscription_details[items][0][price]", "price_power")
				.containsEntry("subscription_details[billing_cycle_anchor]", "now")
				.containsEntry("subscription_details[proration_behavior]", "none");
	}

	@Test
	void andChangesNothing() {
		switches(true).preview(PAYER, "power", "month");

		assertThat(this.asked).doesNotContain("POST /v1/subscriptions/sub_1");
	}

	// --- the Scheduled switch (T90, ADR-0042) ------------------------------------------------------------

	/**
	 * A schedule made from the subscription, then given two phases: the Price they pay until Stripe's period
	 * ends, then the chosen one, once, after which the schedule lets go of the subscription.
	 */
	@Test
	void aScheduledSwitchKeepsThePriceUntilThePeriodEndsThenChanges() {
		PlanSwitch made = switches(true).schedule(PAYER, "power", "month");

		assertThat(made).isEqualTo(new PlanSwitch.Scheduled(at(PERIOD_END)));
		assertThat(this.posted.get("/v1/subscription_schedules")).containsEntry("from_subscription", "sub_1");
		assertThat(this.posted.get("/v1/subscription_schedules/sub_sched_new"))
				.containsEntry("end_behavior", "release")
				.containsEntry("phases[0][items][0][price]", "price_pro")
				.containsEntry("phases[0][start_date]", String.valueOf(PERIOD_START))
				.containsEntry("phases[0][end_date]", String.valueOf(PERIOD_END))
				.containsEntry("phases[1][items][0][price]", "price_power")
				.containsEntry("phases[1][iterations]", "1")
				.containsEntry("phases[1][proration_behavior]", "none");
	}

	@Test
	void aSecondScheduledSwitchReplacesTheFirst() {
		this.schedule = "sub_sched_old";

		switches(true).schedule(PAYER, "power", "month");

		assertThat(this.asked).containsExactly("GET /v1/subscriptions/sub_1",
				"POST /v1/subscription_schedules/sub_sched_old/release", "POST /v1/subscription_schedules",
				"POST /v1/subscription_schedules/sub_sched_new");
	}

	/** Scheduling the Price they already pay is an undo, which is all it can mean. */
	@Test
	void schedulingThePriceTheyAlreadyPayOnlyDropsWhatWasPending() {
		this.schedule = "sub_sched_old";

		assertThat(switches(true).schedule(PAYER, "pro", "month")).isEqualTo(new PlanSwitch.Switched());
		assertThat(this.asked).containsExactly("GET /v1/subscriptions/sub_1",
				"POST /v1/subscription_schedules/sub_sched_old/release");
	}

	@Test
	void undoReleasesThePendingSchedule() {
		this.schedule = "sub_sched_old";

		assertThat(switches(true).undo(PAYER)).isEqualTo(new PlanSwitch.Switched());
		assertThat(this.asked).containsExactly("GET /v1/subscriptions/sub_1",
				"POST /v1/subscription_schedules/sub_sched_old/release");
	}

	/** A second Ongedaan maken, or one pressed after the webhook already cleared it: nothing to release. */
	@Test
	void undoWithNothingPendingChangesNothing() {
		assertThat(switches(true).undo(PAYER)).isEqualTo(new PlanSwitch.Switched());
		assertThat(this.asked).containsExactly("GET /v1/subscriptions/sub_1");
	}

	@Test
	void undoForSomebodyNotPayingIsNotPaying() {
		assertThat(switches(false).undo(PAYER)).isEqualTo(new PlanSwitch.NotPaying());
		assertThat(this.asked).isEmpty();
	}

	// --- the refusals --------------------------------------------------------------------------------------

	/** Nothing to switch, and Stripe is not asked: Checkout is theirs. */
	@Test
	void somebodyStripeIsNotBillingIsNotPaying() {
		assertThat(switches(false).apply(PAYER, "power", "month")).isEqualTo(new PlanSwitch.NotPaying());
		assertThat(switches(false).preview(PAYER, "power", "month")).isEqualTo(new PlanSwitch.NotPaying());
		assertThat(this.asked).isEmpty();
	}

	/**
	 * No switch during Dunning, now or at renewal, and not even priced: the open invoice comes first. Stripe's
	 * own status decides, read on the same call that fetches the subscription.
	 */
	@ParameterizedTest
	@ValueSource(strings = { "past_due", "unpaid", "incomplete" })
	void nothingIsSwitchedWhileAnInvoiceIsOpen(String status) {
		this.status = status;

		assertThat(switches(true).apply(PAYER, "power", "month")).isEqualTo(new PlanSwitch.InvoiceOpen());
		assertThat(switches(true).preview(PAYER, "power", "month")).isEqualTo(new PlanSwitch.InvoiceOpen());
		assertThat(switches(true).schedule(PAYER, "power", "month")).isEqualTo(new PlanSwitch.InvoiceOpen());
		assertThat(this.asked).containsOnly("GET /v1/subscriptions/sub_1");
	}

	/**
	 * Undo is not a switch: it charges nothing, and it is the way out of a cancel the Portal refuses while a
	 * schedule holds the subscription (ADR-0042). So it is allowed during Dunning.
	 */
	@ParameterizedTest
	@ValueSource(strings = { "past_due", "unpaid", "incomplete" })
	void butUndoIsAllowedWhileAnInvoiceIsOpen(String status) {
		this.status = status;
		this.schedule = "sub_sched_old";

		assertThat(switches(true).undo(PAYER)).isEqualTo(new PlanSwitch.Switched());
		assertThat(this.asked).contains("POST /v1/subscription_schedules/sub_sched_old/release");
	}

	/** A bank debit on its way is `active` at Stripe, so it is not Dunning and the subscriber may switch. */
	@ParameterizedTest
	@ValueSource(strings = { "active", "trialing" })
	void anythingElseMaySwitch(String status) {
		this.status = status;

		assertThat(switches(true).apply(PAYER, "power", "month")).isEqualTo(new PlanSwitch.Switched());
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

	/**
	 * What Stripe answers an update with: a held switch for {@code pending_if_incomplete}, a {@code past_due}
	 * one for {@code allow_incomplete}, when the payment needs the payer.
	 */
	private String updated(Map<String, String> form) {
		boolean waits = "pending_if_incomplete".equals(form.get("payment_behavior"));
		boolean owed = this.paymentNeedsThePayer && !waits;
		return subscription("price_power", this.paymentNeedsThePayer && waits, owed ? "past_due" : "active");
	}

	private String subscription(String price, boolean pending, String status) {
		return "{\"id\":\"sub_1\",\"object\":\"subscription\",\"status\":\"" + status + "\","
				+ "\"schedule\":" + (this.schedule == null ? "null" : "\"" + this.schedule + "\"") + ","
				+ "\"default_payment_method\":" + method(this.subscriptionMethod) + ","
				+ "\"customer\":{\"id\":\"cus_1\",\"object\":\"customer\",\"invoice_settings\":"
				+ "{\"default_payment_method\":" + method(this.customerMethod) + "}},"
				+ "\"items\":{\"object\":\"list\",\"data\":[{\"id\":\"si_1\",\"object\":\"subscription_item\","
				+ "\"current_period_start\":" + PERIOD_START + ",\"current_period_end\":" + PERIOD_END + ","
				+ "\"price\":{\"id\":\"" + price + "\",\"object\":\"price\"}}]},"
				+ "\"pending_update\":" + (pending ? "{\"expires_at\":1790000000}" : "null") + ","
				+ "\"latest_invoice\":{\"id\":\"in_1\",\"object\":\"invoice\","
				+ "\"status\":\"open\",\"hosted_invoice_url\":\"https://invoice.stripe.com/i/in_1\"}}";
	}

	/** A schedule made from the subscription: Stripe copies its one phase, and the update adds the second. */
	private static String schedule(boolean twoPhases) {
		String current = "{\"start_date\":" + PERIOD_START + ",\"end_date\":" + PERIOD_END
				+ ",\"items\":[{\"price\":\"price_pro\",\"quantity\":1}]}";
		String next = ",{\"start_date\":" + PERIOD_END + ",\"end_date\":" + (PERIOD_END + 2_592_000L)
				+ ",\"items\":[{\"price\":\"price_power\",\"quantity\":1}]}";
		return "{\"id\":\"sub_sched_new\",\"object\":\"subscription_schedule\",\"status\":\"active\","
				+ "\"subscription\":\"sub_1\",\"phases\":[" + current + (twoPhases ? next : "") + "]}";
	}

	private static OffsetDateTime at(long epochSecond) {
		return Instant.ofEpochSecond(epochSecond).atOffset(ZoneOffset.UTC);
	}

	private static String method(String type) {
		return type == null ? "null"
				: "{\"id\":\"pm_1\",\"object\":\"payment_method\",\"type\":\"" + type + "\"}";
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
			public Optional<com.mprelist.subscription.PendingSwitch> pendingSwitchFor(UserRef user) {
				throw new UnsupportedOperationException("that is the display's question");
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
