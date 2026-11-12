package com.mprelist.billing.internal;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Proxy;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import com.mprelist.subscription.Mirroring;
import com.mprelist.subscription.SubscriptionMirror;
import com.mprelist.subscription.SubscriptionStatus;
import com.stripe.StripeClient;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * A {@code past_due} whose invoice is being paid is not Dunning (ADR-0036, amended 2026-11-12): a SEPA debit
 * reads {@code past_due} until it clears, which in live mode is days of a subscriber refused every relist for an
 * invoice they paid. A debit that bounces is still Dunning, and that is what revokes access.
 */
class InvoicesBeingPaidTest {

	private HttpServer stripe;

	/** The status of the PaymentIntent paying {@code in_1}, or {@code null} for an invoice with no payment. */
	private String intent = "processing";

	private boolean stripeAnswers = true;

	private final List<String> asked = new ArrayList<>();

	@BeforeEach
	void startStripe() throws IOException {
		this.stripe = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
		this.stripe.createContext("/v1/", exchange -> {
			String path = exchange.getRequestURI().getPath();
			this.asked.add(path + "?" + exchange.getRequestURI().getQuery());
			if (!this.stripeAnswers) {
				respond(exchange, 500, "{\"error\":{\"message\":\"no\"}}");
				return;
			}
			switch (path) {
				case "/v1/invoices/in_1" -> respond(exchange, 200,
						"{\"id\":\"in_1\",\"object\":\"invoice\",\"status\":\"open\",\"payments\":{\"object\":\"list\","
								+ "\"data\":" + (this.intent == null ? "[]"
										: "[{\"id\":\"inpay_1\",\"object\":\"invoice_payment\",\"payment\":"
												+ "{\"type\":\"payment_intent\",\"payment_intent\":\"pi_1\"}}]")
								+ "}}");
				case "/v1/payment_intents/pi_1" -> respond(exchange, 200,
						"{\"id\":\"pi_1\",\"object\":\"payment_intent\",\"status\":\"" + this.intent + "\"}");
				default -> respond(exchange, 404, "{\"error\":{\"message\":\"not faked\"}}");
			}
		});
		this.stripe.start();
	}

	@AfterEach
	void stopStripe() {
		this.stripe.stop(0);
	}

	// --- the check -----------------------------------------------------------------------------------------

	/** A debit on its way, or one that cleared before the {@code past_due} was read. */
	@ParameterizedTest
	@ValueSource(strings = { "processing", "succeeded" })
	void aPaymentOnItsWayOrDoneIsBeingPaid(String status) {
		this.intent = status;

		assertThat(invoices().beingPaid("in_1")).isTrue();
		assertThat(this.asked).anyMatch(request -> request.startsWith("/v1/invoices/in_1?expand[0]=payments"));
	}

	/** Waiting on the payer, bounced, or given up: Dunning, which refuses relisting until it is paid. */
	@ParameterizedTest
	@ValueSource(strings = { "requires_payment_method", "requires_action", "requires_confirmation", "canceled" })
	void anythingElseIsDunning(String status) {
		this.intent = status;

		assertThat(invoices().beingPaid("in_1")).isFalse();
	}

	@Test
	void soIsAnInvoiceNothingIsPaying() {
		this.intent = null;

		assertThat(invoices().beingPaid("in_1")).isFalse();
	}

	/** Stripe's word stands where it cannot be checked; the {@code active} after a cleared debit puts it right. */
	@Test
	void aStripeThatWillNotAnswerLeavesItPastDue() {
		this.stripeAnswers = false;

		assertThat(invoices().beingPaid("in_1")).isFalse();
	}

	@Test
	void andSoDoesAStripeNobodyConfigured() {
		assertThat(new InvoicesBeingPaid(new StripeAccount("")).beingPaid("in_1")).isFalse();
		assertThat(this.asked).isEmpty();
	}

	// --- the mirror ----------------------------------------------------------------------------------------

	@Test
	void aPastDueWhoseDebitIsOnItsWayIsMirroredAsActive() {
		assertThat(mirroredFrom("past_due", "\"in_1\"")).containsExactly(SubscriptionStatus.ACTIVE);
	}

	@Test
	void aPastDueWhoseDebitBouncedIsMirroredAsPastDue() {
		this.intent = "requires_payment_method";

		assertThat(mirroredFrom("past_due", "\"in_1\"")).containsExactly(SubscriptionStatus.PAST_DUE);
	}

	@Test
	void aPastDueNamingNoInvoiceIsMirroredAsPastDue() {
		assertThat(mirroredFrom("past_due", "null")).containsExactly(SubscriptionStatus.PAST_DUE);
		assertThat(this.asked).isEmpty();
	}

	/** Only {@code past_due} is asked about: an active subscription costs the webhook no Stripe call. */
	@Test
	void anythingButPastDueIsMirroredAsReportedWithoutAsking() {
		assertThat(mirroredFrom("active", "\"in_1\"")).containsExactly(SubscriptionStatus.ACTIVE);
		assertThat(mirroredFrom("unpaid", "\"in_1\"")).containsExactly(SubscriptionStatus.UNPAID);
		assertThat(this.asked).isEmpty();
	}

	// --- by hand -------------------------------------------------------------------------------------------

	private InvoicesBeingPaid invoices() {
		return new InvoicesBeingPaid(new StripeAccount(StripeClient.builder()
				.setApiKey("sk_test_not_a_real_key")
				.setApiBase("http://localhost:" + this.stripe.getAddress().getPort())
				.setMaxNetworkRetries(0)
				.build()));
	}

	/** The statuses the mirror was handed for one {@code customer.subscription.updated}. */
	private List<SubscriptionStatus> mirroredFrom(String status, String latestInvoice) {
		List<SubscriptionStatus> mirrored = new ArrayList<>();
		SubscriptionMirror recording = (SubscriptionMirror) Proxy.newProxyInstance(getClass().getClassLoader(),
				new Class<?>[] { SubscriptionMirror.class }, (proxy, method, arguments) -> {
					if (method.getName().equals("mirror")) {
						mirrored.add((SubscriptionStatus) arguments[1]);
					}
					return Mirroring.MIRRORED;
				});
		new MirrorSubscriptions(recording, invoices()).apply(StripeEvent.in("""
				{"id":"evt_1","type":"customer.subscription.updated","created":1794000060,
				 "data":{"object":{"id":"sub_1","object":"subscription","customer":"cus_1","status":"%s",
				  "latest_invoice":%s,"cancel_at_period_end":false,
				  "items":{"data":[{"id":"si_1","price":{"id":"price_power"},
				   "current_period_start":1794000000,"current_period_end":1796592000}]}}}}
				""".formatted(status, latestInvoice)));
		return mirrored;
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
