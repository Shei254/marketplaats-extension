package com.mprelist.billing.internal;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.mprelist.catalog.Entitlement;
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
 * What we actually send Stripe when somebody buys a plan (T19, #29).
 *
 * <p>Asserted against the bytes on the wire rather than through a mocked SDK, for {@code StripePriceCacheTest}'s
 * reason and one sharper: the fields here are the ones that decide whether the money can ever be traced back
 * to an account — our own id travels on the session and again on the subscription it creates, which is how the
 * webhook (T20, #30) knows whose plan just moved, and a mock would happily accept either of them missing.
 *
 * <p>No Spring, no database and no token: the catalog and the subscription mirror are the two interfaces this
 * needs, and both are public ports with one method each worth standing up by hand. The route around it —
 * statuses, refusals, who may call — is {@code CheckoutTest}.
 */
class CheckoutSessionTest {

	private static final UserRef BUYER = new UserRef(UUID.fromString("11111111-2222-3333-4444-555555555555"));

	private static final SellablePlan PRO = new SellablePlan(new TierName("pro", "Pro"),
			List.of(new TierPrice("price_pro", "month")), new Entitlement(50, 1, Map.of()));

	/** The same plan sold at two rhythms, which is what T62 (#128) made possible. */
	private static final SellablePlan PRO_YEARLY_TOO = new SellablePlan(new TierName("pro", "Pro"),
			List.of(new TierPrice("price_pro", "month"), new TierPrice("price_pro_yearly", "year")),
			new Entitlement(50, 1, Map.of()));

	private HttpServer stripe;

	/** The form Stripe was posted, decoded. Null until a session is created. */
	private Map<String, String> posted;

	private boolean stripeAnswers = true;

	@BeforeEach
	void startStripe() throws IOException {
		this.stripe = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
		this.stripe.createContext("/v1/checkout/sessions", exchange -> {
			this.posted = formIn(new String(exchange.getRequestBody().readAllBytes(), UTF_8));
			if (!this.stripeAnswers) {
				respond(exchange, 500, "{\"error\":{\"message\":\"no\"}}");
				return;
			}
			respond(exchange, 200, "{\"id\":\"cs_test_1\",\"object\":\"checkout.session\","
					+ "\"url\":\"https://checkout.stripe.com/c/pay/cs_test_1\"}");
		});
		this.stripe.start();
	}

	@AfterEach
	void stopStripe() {
		this.stripe.stop(0);
	}

	@Test
	void aPlanOnSaleBecomesAUrlToSendTheBrowserTo() {
		Checkout opened = checkout(List.of(PRO), Optional.empty()).open(BUYER, "pro", "month");

		assertThat(opened).isEqualTo(new Checkout.Opened("https://checkout.stripe.com/c/pay/cs_test_1"));
	}

	@Test
	void andTheSessionIsASubscriptionForThatTiersPrice() {
		checkout(List.of(PRO), Optional.empty()).open(BUYER, "pro", "month");

		assertThat(this.posted).containsEntry("mode", "subscription");
		assertThat(this.posted).containsEntry("line_items[0][price]", "price_pro");
		assertThat(this.posted).containsEntry("line_items[0][quantity]", "1");
	}

	/**
	 * The thread the webhook pulls. {@code client_reference_id} is the whole of how T20 (#30) will know whose
	 * subscription just started — this application deliberately holds no email address to match on (#108), so
	 * without this the money arrives attached to nobody.
	 */
	@Test
	void andItCarriesOurOwnAccountIdSoThePaymentCanBeTracedBack() {
		checkout(List.of(PRO), Optional.empty()).open(BUYER, "pro", "month");

		assertThat(this.posted).containsEntry("client_reference_id", BUYER.id().toString());
	}

	/**
	 * And the subscription the session creates carries it too, which is the thread that outlives the session:
	 * Stripe copies {@code subscription_data.metadata} onto the subscription, so every event about it —
	 * including the cancellation months later, where no session is in sight — names the account it belongs to.
	 * Without this the mirror (T20, #30) would have to match a customer id it has only ever learned from an
	 * earlier event, and a purchase whose events arrive in Stripe's usual order would have nothing to match on
	 * at all.
	 */
	@Test
	void andTheSubscriptionItCreatesCarriesItToo() {
		checkout(List.of(PRO), Optional.empty()).open(BUYER, "pro", "month");

		assertThat(this.posted).containsEntry("subscription_data[metadata][app_user_id]", BUYER.id().toString());
	}

	/**
	 * The one field that decides whether the other methods can appear at all. Stripe's Adaptive Pricing
	 * converts a session into the buyer's local currency, and a converted <em>subscription</em> is offered
	 * card, Link, Apple Pay and Google Pay only — so a Dutch marketplace that left it on would advertise
	 * iDEAL, SEPA and PayPal on the plan screen and show a card form to anybody outside the eurozone. Nothing
	 * fails, and the session's own {@code payment_method_types} still names all three, because the conversion
	 * happens when the page is opened rather than when it is created. Asserted here because that makes it a
	 * setting nothing else in this codebase can observe.
	 */
	@Test
	void andIsPricedInThePricesOwnCurrencyRatherThanTheBuyersLocalOne() {
		checkout(List.of(PRO), Optional.empty()).open(BUYER, "pro", "month");

		assertThat(this.posted).containsEntry("adaptive_pricing[enabled]", "false");
	}

	@Test
	void andSendsTheBrowserBackToTheLoginlessPages() {
		checkout(List.of(PRO), Optional.empty()).open(BUYER, "pro", "month");

		// `apps/web`'s own PATHS, on the other side of a Java/TypeScript boundary. The pages carry no auth at
		// all: the browser Stripe redirects is not one this API knows anything about (ADR-0017).
		assertThat(this.posted).containsEntry("success_url", "https://example.test/success");
		assertThat(this.posted).containsEntry("cancel_url", "https://example.test/cancel");
	}

	/**
	 * A returning subscriber is the same customer, which is what ADR-0018 keeps {@code stripe_customer_id} for
	 * when a cancellation drops somebody back to free. Without this, resubscribing would start a second
	 * billing history and leave the Customer Portal (T21, #31) pointing at whichever half our row named.
	 */
	@Test
	void andSomebodyWhoHasPaidBeforeBuysAsTheSameCustomer() {
		checkout(List.of(PRO), Optional.of("cus_returning")).open(BUYER, "pro", "month");

		assertThat(this.posted).containsEntry("customer", "cus_returning");
	}

	@Test
	void whileSomebodyWhoNeverHasArrivesAsAStranger() {
		// Stripe makes the customer itself, and the webhook stores whichever id it reports.
		checkout(List.of(PRO), Optional.empty()).open(BUYER, "pro", "month");

		assertThat(this.posted).doesNotContainKey("customer");
	}

	@Test
	void nothingElseAboutThemIsSent() {
		// Not a name, not an address, not an email — this application holds none of them (#108), and Stripe
		// collects what it needs from the buyer itself.
		checkout(List.of(PRO), Optional.of("cus_returning")).open(BUYER, "pro", "month");

		assertThat(this.posted.keySet()).allSatisfy(key -> assertThat(key)
				.doesNotContain("email").doesNotContain("name").doesNotContain("address"));
	}

	// --- what is not for sale ------------------------------------------------------------------------------

	@Test
	void aCodeNothingIsSoldUnderOpensNoSession() {
		Checkout answered = checkout(List.of(PRO), Optional.empty()).open(BUYER, "starter", "month");

		assertThat(answered).isEqualTo(new Checkout.NotForSale());
		assertThat(this.posted).isNull();
	}

	@Test
	void andNeitherDoesAnEmptyCatalog() {
		// Which is every stack whose Stripe Prices have not been created yet (T22, #28) — and, notably, the
		// free tier, which is never in this list at all.
		assertThat(checkout(List.of(), Optional.empty()).open(BUYER, "free", "month"))
				.isEqualTo(new Checkout.NotForSale());
	}

	// --- somebody already paying (T83) ----------------------------------------------------------------------

	/**
	 * Stripe would take the money. It knows the customer — the id above is passed precisely so it does — and
	 * still creates a second subscription on it, so somebody on Pro who presses Business is charged for both.
	 * A plan switch is the Customer Portal's, which prorates it; this route sells a first subscription only.
	 */
	@Test
	void somebodyStripeIsAlreadyBillingOpensNoSecondSubscription() {
		Checkout answered = checkout(List.of(PRO), Optional.of("cus_paying"), true).open(BUYER, "pro", "month");

		assertThat(answered).isEqualTo(new Checkout.AlreadyPaying());
		assertThat(this.posted).isNull();
	}

	/**
	 * Asked before what is on sale, because it is the more useful answer: a payer holding yesterday's cards is
	 * going to the Portal either way, and "that plan is gone" would send them looking for another to buy.
	 */
	@Test
	void whateverTheyAskedFor() {
		assertThat(checkout(List.of(PRO), Optional.of("cus_paying"), true).open(BUYER, "starter", "month"))
				.isEqualTo(new Checkout.AlreadyPaying());
	}

	/** And it needs no Stripe to say so: the mirror is ours, and the answer is about the caller. */
	@Test
	void evenWithNoStripeToAsk() {
		OpenCheckout unconfigured = new OpenCheckout(catalogOf(List.of(PRO)),
				subscriberWith(Optional.of("cus_paying"), true), new StripeAccount(""), pages("https://example.test"));

		assertThat(unconfigured.open(BUYER, "pro", "month")).isEqualTo(new Checkout.AlreadyPaying());
	}

	/**
	 * While somebody who cancelled is not paying, and buys again as the same customer — ADR-0018 keeps their
	 * customer id and clears the subscription, which is the whole of the difference between the two.
	 */
	@Test
	void whileSomebodyWhoCancelledIsNot() {
		Checkout opened = checkout(List.of(PRO), Optional.of("cus_returning"), false).open(BUYER, "pro", "month");

		assertThat(opened).isInstanceOf(Checkout.Opened.class);
		assertThat(this.posted).containsEntry("customer", "cus_returning");
	}

	// --- what a retry could fix ----------------------------------------------------------------------------

	@Test
	void aStripeThatWillNotAnswerIsUnavailableRatherThanNotForSale() {
		// The two must not collapse: one says the plan is gone and one says come back in a minute, and a
		// client showing "that plan no longer exists" for a network blip would be lying to a buyer.
		this.stripeAnswers = false;

		assertThat(checkout(List.of(PRO), Optional.empty()).open(BUYER, "pro", "month"))
				.isEqualTo(new Checkout.Unavailable());
	}

	@Test
	void andSoIsAStripeNobodyConfigured() {
		OpenCheckout unconfigured = new OpenCheckout(catalogOf(List.of(PRO)), subscriberWith(Optional.empty()),
				new StripeAccount(""), pages("https://example.test"));

		assertThat(unconfigured.open(BUYER, "pro", "month")).isEqualTo(new Checkout.Unavailable());
	}

	/** And a plan that is not for sale is answered as such even with no Stripe to ask, since it never asks. */
	@Test
	void whileNothingOnSaleIsStillNothingOnSale() {
		OpenCheckout unconfigured = new OpenCheckout(catalogOf(List.of(PRO)), subscriberWith(Optional.empty()),
				new StripeAccount(""), pages("https://example.test"));

		assertThat(unconfigured.open(BUYER, "starter", "month")).isEqualTo(new Checkout.NotForSale());
	}

	@Test
	void aBaseUrlWithATrailingSlashDoesNotBecomeADoubleOne() {
		// `https://example.test//success` is a URL Stripe accepts and a page most hosts do not serve, at the
		// moment somebody has just been charged.
		new OpenCheckout(catalogOf(List.of(PRO)), subscriberWith(Optional.empty()), account(),
				pages("https://example.test/")).open(BUYER, "pro", "month");

		assertThat(this.posted).containsEntry("success_url", "https://example.test/success");
	}

	/**
	 * The body a `200` carries, pinned where it can be: an object with one field, not the bare string.
	 *
	 * <p>Asserted here rather than over a real port because a `200` from that route needs a live Stripe
	 * account — which is the click-through's (slice C, step 4). What can be checked without one is that the
	 * shape both clients are typed against is the shape this serialises to.
	 */
	@Test
	void theBodyAUrlComesBackInIsAnObjectRatherThanAString() {
		String body = tools.jackson.databind.json.JsonMapper.builder().build()
				.writeValueAsString(new StartCheckout.CheckoutSession("https://checkout.stripe.com/c/pay/x"));

		assertThat(body).isEqualTo("{\"url\":\"https://checkout.stripe.com/c/pay/x\"}");
	}

	// --- the collaborators, by hand ------------------------------------------------------------------------

	private OpenCheckout checkout(List<SellablePlan> onSale, Optional<String> customer) {
		return checkout(onSale, customer, false);
	}

	private OpenCheckout checkout(List<SellablePlan> onSale, Optional<String> customer, boolean paying) {
		return new OpenCheckout(catalogOf(onSale), subscriberWith(customer, paying), account(),
				pages("https://example.test"));
	}

	private static WebPages pages(String baseUrl) {
		return new WebPages(baseUrl);
	}

	private StripeAccount account() {
		return new StripeAccount(StripeClient.builder()
				.setApiKey("sk_test_not_a_real_key")
				.setApiBase("http://localhost:" + this.stripe.getAddress().getPort())
				.setMaxNetworkRetries(0)
				.build());
	}

	/** Only `published()` is ever called; the other three throw so a test that leaned on one would say so. */
	private static TierCatalog catalogOf(List<SellablePlan> onSale) {
		return new TierCatalog() {

			@Override
			public java.util.Optional<TierId> defaultTier() {
				throw new UnsupportedOperationException("not part of buying a plan");
			}

			@Override
			public Entitlement entitlementOf(TierId tier) {
				throw new UnsupportedOperationException("not part of buying a plan");
			}

			@Override
			public TierName nameOf(TierId tier) {
				throw new UnsupportedOperationException("not part of buying a plan");
			}

			@Override
			public List<SellablePlan> published() {
				return onSale;
			}

			@Override
			public Optional<TierId> tierSoldAs(String stripePriceId) {
				throw new UnsupportedOperationException("that is the webhook's question, not this one's");
			}

		};
	}

	private static Subscriptions subscriberWith(Optional<String> customer) {
		return subscriberWith(customer, false);
	}

	private static Subscriptions subscriberWith(Optional<String> customer, boolean paying) {
		return new Subscriptions() {

			@Override
			public Subscription currentFor(UserRef user) {
				throw new UnsupportedOperationException("buying a plan does not read the current one");
			}

			@Override
			public Optional<String> stripeCustomerFor(UserRef user) {
				return customer;
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
