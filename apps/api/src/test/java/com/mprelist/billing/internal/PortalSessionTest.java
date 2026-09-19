package com.mprelist.billing.internal;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.mprelist.identity.UserRef;
import com.mprelist.subscription.Subscription;
import com.mprelist.subscription.Subscriptions;
import com.stripe.StripeClient;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * What we actually send Stripe when somebody asks to manage their billing (T21, #31).
 *
 * <p>Against the bytes on a loopback socket rather than through a mocked SDK, for {@code CheckoutSessionTest}'s
 * reason: the two fields here are the whole of the request, and a mock would accept either of them missing.
 * The one that matters is the customer — a Portal session opened for the wrong one shows a stranger somebody
 * else's invoices, which is the worst thing this endpoint could do.
 *
 * <p>No Spring, no database and no token: the subscription mirror is the only collaborator, and it is a public
 * port with one method worth standing up by hand. The route around it — statuses, who may call — is
 * {@code PortalTest}.
 */
class PortalSessionTest {

	private static final UserRef SUBSCRIBER = new UserRef(UUID.fromString("11111111-2222-3333-4444-555555555555"));

	private HttpServer stripe;

	/** The form Stripe was posted, decoded. Null until a session is asked for. */
	private Map<String, String> posted;

	private boolean stripeAnswers = true;

	@BeforeEach
	void startStripe() throws IOException {
		this.stripe = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
		this.stripe.createContext("/v1/billing_portal/sessions", exchange -> {
			this.posted = formIn(new String(exchange.getRequestBody().readAllBytes(), UTF_8));
			if (!this.stripeAnswers) {
				// What a Stripe account whose Portal has never been configured actually answers, which is the
				// likeliest failure here and the one the log line has to be readable enough to explain.
				respond(exchange, 400, "{\"error\":{\"message\":\"No configuration provided and your test mode "
						+ "default configuration has not been created.\"}}");
				return;
			}
			respond(exchange, 200, "{\"id\":\"bps_test_1\",\"object\":\"billing_portal.session\","
					+ "\"url\":\"https://billing.stripe.com/p/session/bps_test_1\"}");
		});
		this.stripe.start();
	}

	@AfterEach
	void stopStripe() {
		this.stripe.stop(0);
	}

	@Test
	void somebodyWhoHasPaidGetsAUrlToSendTheBrowserTo() {
		Portal opened = portal(Optional.of("cus_paying")).open(SUBSCRIBER);

		assertThat(opened).isEqualTo(new Portal.Opened("https://billing.stripe.com/p/session/bps_test_1"));
	}

	/**
	 * And it is opened for <em>their</em> customer. The id comes off their own row and nothing else is sent,
	 * because everything the Portal shows — the card, the invoices, the cancel button — hangs off exactly this
	 * field: the wrong one here is somebody reading a stranger's billing history.
	 */
	@Test
	void andItIsOpenedForTheirOwnStripeCustomer() {
		portal(Optional.of("cus_paying")).open(SUBSCRIBER);

		assertThat(this.posted).containsEntry("customer", "cus_paying");
	}

	@Test
	void andStripeSendsThemBackToALoginlessPageOfOurOwn() {
		portal(Optional.of("cus_paying")).open(SUBSCRIBER);

		// `apps/web`'s own PATHS, on the other side of a Java/TypeScript boundary — and not `/success`, which
		// congratulates somebody on a payment. The commonest reason to be in the Portal is cancelling.
		assertThat(this.posted).containsEntry("return_url", "https://example.test/billing");
	}

	@Test
	void nothingElseAboutThemIsSent() {
		portal(Optional.of("cus_paying")).open(SUBSCRIBER);

		// Not our own account id either: unlike a Checkout session, nothing comes back from this to attribute.
		assertThat(this.posted.keySet()).containsExactlyInAnyOrder("customer", "return_url");
	}

	// --- what there is nothing to manage for ---------------------------------------------------------------

	@Test
	void anAccountThatHasNeverPaidHasNothingToManage() {
		Portal answered = portal(Optional.empty()).open(SUBSCRIBER);

		assertThat(answered).isEqualTo(new Portal.NothingToManage());
		// And Stripe is not asked, since there is no customer to name in the question.
		assertThat(this.posted).isNull();
	}

	// --- what a retry could fix ----------------------------------------------------------------------------

	@Test
	void aStripeThatWillNotAnswerIsUnavailableRatherThanNothingToManage() {
		// The two must not collapse: one says you have never bought anything and one says come back in a
		// minute, and telling a paying subscriber they have no billing account would be a support ticket.
		this.stripeAnswers = false;

		assertThat(portal(Optional.of("cus_paying")).open(SUBSCRIBER)).isEqualTo(new Portal.Unavailable());
	}

	@Test
	void andSoIsAStripeNobodyConfigured() {
		OpenPortal unconfigured = new OpenPortal(subscriberWith(Optional.of("cus_paying")), new StripeAccount(""),
				new WebPages("https://example.test"));

		assertThat(unconfigured.open(SUBSCRIBER)).isEqualTo(new Portal.Unavailable());
	}

	/** While an account with nothing to manage is answered as such with no Stripe to ask, since it never asks. */
	@Test
	void whileNothingToManageIsStillNothingToManage() {
		OpenPortal unconfigured = new OpenPortal(subscriberWith(Optional.empty()), new StripeAccount(""),
				new WebPages("https://example.test"));

		assertThat(unconfigured.open(SUBSCRIBER)).isEqualTo(new Portal.NothingToManage());
	}

	@Test
	void aBaseUrlWithATrailingSlashDoesNotBecomeADoubleOne() {
		new OpenPortal(subscriberWith(Optional.of("cus_paying")), account(), new WebPages("https://example.test/"))
				.open(SUBSCRIBER);

		assertThat(this.posted).containsEntry("return_url", "https://example.test/billing");
	}

	/**
	 * The body a `200` carries, pinned where it can be: an object with one field, not the bare string.
	 *
	 * <p>Asserted here rather than over a real port because a `200` from that route needs a live Stripe account
	 * with its Portal configured — which is the click-through's (slice C, step 7).
	 */
	@Test
	void theBodyAUrlComesBackInIsAnObjectRatherThanAString() {
		String body = tools.jackson.databind.json.JsonMapper.builder().build()
				.writeValueAsString(new StartPortal.PortalSession("https://billing.stripe.com/p/session/x"));

		assertThat(body).isEqualTo("{\"url\":\"https://billing.stripe.com/p/session/x\"}");
	}

	// --- the collaborators, by hand ------------------------------------------------------------------------

	private OpenPortal portal(Optional<String> customer) {
		return new OpenPortal(subscriberWith(customer), account(), new WebPages("https://example.test"));
	}

	private StripeAccount account() {
		return new StripeAccount(StripeClient.builder()
				.setApiKey("sk_test_not_a_real_key")
				.setApiBase("http://localhost:" + this.stripe.getAddress().getPort())
				.setMaxNetworkRetries(0)
				.build());
	}

	private static Subscriptions subscriberWith(Optional<String> customer) {
		return new Subscriptions() {

			@Override
			public Subscription currentFor(UserRef user) {
				throw new UnsupportedOperationException("managing billing does not read the current plan");
			}

			@Override
			public Optional<String> stripeCustomerFor(UserRef user) {
				return customer;
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
