package com.mprelist.billing.internal;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.mprelist.catalog.OutstandingCleanup;
import com.mprelist.catalog.StripeCleanup;
import com.mprelist.catalog.TierTeardown;
import com.stripe.StripeClient;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * The Stripe half of a deleted tier (T77,
 * <a href="../../../../../../docs/adr/0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md">ADR-0032</a>):
 * what the drain actually asks Stripe for, and what it does with each answer.
 *
 * <p><strong>Against the bytes on a loopback socket rather than a mocked SDK</strong>, for
 * {@link UnadoptedPriceTest}'s reason and one that is sharper here: what is at risk is the <em>body</em> of
 * one call. Archiving a Price and clearing its tag have to ride in the same {@code price.update}, because an
 * archive that left the tag on fires a {@code price.updated} the sync adopts — the tier comes straight back.
 * A mocked {@code prices().update} would assert that our own mock was called and pass with the tag intact.
 *
 * <p><strong>The queue is in memory and the database is nowhere in sight.</strong> What
 * {@code stripe_cleanup} does with a row is {@code TierDeletionTest}'s, against a real Postgres; this is
 * about the calls, so the port is implemented by a list and the assertions are about what Stripe was sent and
 * which rows were closed.
 */
class StripeTearDownTest {

	private HttpServer stripe;

	/** Every request the drain made, in order: the method, the path, and the form body it posted. */
	private final List<Call> made = new ArrayList<>();

	/**
	 * What Stripe answers, keyed {@code "<METHOD> <path>"}. Absent means a {@code 200} with an empty object.
	 *
	 * <p>The method is in the key because one of these rows makes <em>two</em> calls to one path: a refused
	 * {@code DELETE /v1/subscriptions/{id}} is followed by a {@code GET} of the same id, to find out whether
	 * Stripe is still billing it. Keyed on the path alone, the second would be answered with the first's
	 * refusal and the test would pass for the wrong reason.
	 */
	private final Map<String, Answer> answers = new LinkedHashMap<>();

	private final Queue queue = new Queue();

	@BeforeEach
	void startStripe() throws IOException {
		this.stripe = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
		this.stripe.createContext("/v1", exchange -> {
			String path = exchange.getRequestURI().getPath();
			String method = exchange.getRequestMethod();
			this.made.add(new Call(method, path,
					form(new String(exchange.getRequestBody().readAllBytes(), UTF_8))));
			Answer answer = this.answers.getOrDefault(method + " " + path, new Answer(200, "{}"));
			respond(exchange, answer.status(), answer.body());
		});
		this.stripe.start();
	}

	@AfterEach
	void stopStripe() {
		this.stripe.stop(0);
	}

	// --- the calls themselves ---------------------------------------------------------------------------------

	/**
	 * Archiving a Price and clearing its tag are <strong>one</strong> {@code price.update}.
	 *
	 * <p>This is the assertion the whole tear-down turns on. Archiving alone fires a {@code price.updated}
	 * that still carries {@code metadata.tier_code}, and the sync drafts the deleted tier back at quota 0 —
	 * as a log line nobody is reading. Cleared in the same call, the tag reads as absent to
	 * {@code StripeEvent.taggedPrice()}, so the event the clearing itself fires is a no-op by construction.
	 */
	@Test
	void archivingAPriceClearsItsTagInTheSameCall() {
		this.queue.add(StripeCleanup.ARCHIVE_PRICE, "price_pro");
		this.answers.put("POST /v1/prices/price_pro", new Answer(200, price("price_pro", "prod_pro")));

		drain();

		Call archived = onlyCallTo("/v1/prices/price_pro");
		assertThat(archived.method()).isEqualTo("POST");
		assertThat(archived.body()).containsEntry("active", "false");
		assertThat(archived.body()).containsEntry("metadata[tier_code]", "");
	}

	/**
	 * And the Product is queued from what came back, because its id was never stored.
	 *
	 * <p>{@code tier_price} holds Price ids and the tier row that might have carried a Product id does not
	 * exist any more by the time this runs — so the {@code retrieve} ADR-0032 budgeted for turns out to be
	 * the answer to the update that was being made anyway.
	 */
	@Test
	void andTheProductItBelongedToIsQueuedFromTheAnswer() {
		this.queue.add(StripeCleanup.ARCHIVE_PRICE, "price_pro");
		this.answers.put("POST /v1/prices/price_pro", new Answer(200, price("price_pro", "prod_pro")));

		drain();

		assertThat(this.queue.outstanding(10))
				.map(OutstandingCleanup::kind, OutstandingCleanup::stripeId)
				.containsExactly(org.assertj.core.groups.Tuple.tuple(StripeCleanup.ARCHIVE_PRODUCT, "prod_pro"));
	}

	/** A Product is archived rather than deleted: Stripe refuses to delete one that ever held a Price. */
	@Test
	void aProductIsArchivedBecauseStripeWillNotDeleteOneThatEverHeldAPrice() {
		this.queue.add(StripeCleanup.ARCHIVE_PRODUCT, "prod_pro");

		drain();

		Call archived = onlyCallTo("/v1/products/prod_pro");
		assertThat(archived.method()).isEqualTo("POST");
		assertThat(archived.body()).containsEntry("active", "false");
	}

	/**
	 * A live subscription is cancelled, which is the call that stops real money moving.
	 *
	 * <p>Archiving a Price stops <em>new</em> purchases and nothing else — existing subscriptions keep
	 * renewing against an archived Price — so a delete that only tidied the catalog would leave customers
	 * paying monthly for a tier that no longer exists, and nothing anywhere would raise it again.
	 */
	@Test
	void aLiveSubscriptionIsCancelledRatherThanLeftRenewingAgainstAPlanThatIsGone() {
		this.queue.add(StripeCleanup.CANCEL_SUBSCRIPTION, "sub_someone");

		drain();

		assertThat(onlyCallTo("/v1/subscriptions/sub_someone").method()).isEqualTo("DELETE");
	}

	// --- what it does with each answer ------------------------------------------------------------------------

	@Test
	void aCallStripeAcceptsIsDoneWithAndNotMadeAgain() {
		this.queue.add(StripeCleanup.ARCHIVE_PRODUCT, "prod_pro");

		drain();
		drain();

		assertThat(this.queue.outstanding(10)).isEmpty();
		assertThat(this.made).hasSize(1);
	}

	/**
	 * A refusal counts an attempt, keeps Stripe's own sentence, and stays outstanding.
	 *
	 * <p><strong>Nothing gives up</strong>, which is the cost ADR-0032 accepts out loud: this is the
	 * application's first durable work queue, and a row nobody can drain is a row somebody has to notice. What
	 * makes it noticeable is these two columns rather than a log line that scrolls.
	 */
	@Test
	void aCallStripeRefusesIsCountedKeptAndTriedAgain() {
		this.queue.add(StripeCleanup.ARCHIVE_PRODUCT, "prod_pro");
		this.answers.put("POST /v1/products/prod_pro",
				new Answer(400, "{\"error\":{\"type\":\"invalid_request_error\",\"message\":\"nope\"}}"));

		drain();

		assertThat(this.queue.outstanding(10)).singleElement()
				.satisfies(call -> assertThat(call.attempts()).isEqualTo(1));
		assertThat(this.queue.errors).containsExactly("nope");
	}

	/**
	 * And a Stripe that says the object is not there is <strong>done</strong>, not refused.
	 *
	 * <p>A Price Stripe does not hold cannot resurrect a tier, which is the whole of what archiving it was
	 * for. Left outstanding it would be a row nobody could ever drain — and it would keep the tier's code
	 * closed to the sync for ever, which is precisely the permanent tombstone the ADR rejected.
	 */
	@Test
	void whileAnObjectStripeDoesNotHoldIsDoneRatherThanStuck() {
		this.queue.add(StripeCleanup.CANCEL_SUBSCRIPTION, "sub_cancelled_by_hand");
		this.answers.put("DELETE /v1/subscriptions/sub_cancelled_by_hand", new Answer(404,
				"{\"error\":{\"type\":\"invalid_request_error\",\"code\":\"resource_missing\","
						+ "\"message\":\"No such subscription\"}}"));

		drain();

		assertThat(this.queue.outstanding(10)).isEmpty();
	}

	/**
	 * And a subscription somebody already cancelled by hand is done, although Stripe refuses the cancel as an
	 * ordinary invalid request rather than as a missing resource.
	 *
	 * <p><strong>This is the row that would otherwise stick for ever</strong>, and sticking is not a local
	 * cost: {@code isBeingTornDown} keys on the tier code, so one undrainable row keeps that code closed to
	 * the price sync indefinitely — which is exactly the permanent tombstone ADR-0032 rejected in favour of
	 * one scoped to the window. So a refused cancellation asks what Stripe actually holds, and a subscription
	 * already in a terminal state is treated as done.
	 */
	@Test
	void andASubscriptionAlreadyCancelledByHandIsDoneRatherThanStuckForEver() {
		this.queue.add(StripeCleanup.CANCEL_SUBSCRIPTION, "sub_cancelled_in_the_dashboard");
		this.answers.put("DELETE /v1/subscriptions/sub_cancelled_in_the_dashboard", new Answer(400,
				"{\"error\":{\"type\":\"invalid_request_error\","
						+ "\"message\":\"A subscription can only be cancelled once.\"}}"));
		this.answers.put("GET /v1/subscriptions/sub_cancelled_in_the_dashboard",
				new Answer(200, subscription("sub_cancelled_in_the_dashboard", "canceled")));

		drain();

		assertThat(this.queue.outstanding(10)).isEmpty();
	}

	/**
	 * And one Stripe is still billing stays outstanding, which is what stops the check above from being a way
	 * to quietly give up on a cancellation that matters.
	 */
	@Test
	void whileOneStripeIsStillBillingStaysOutstanding() {
		this.queue.add(StripeCleanup.CANCEL_SUBSCRIPTION, "sub_live");
		this.answers.put("DELETE /v1/subscriptions/sub_live", new Answer(400,
				"{\"error\":{\"type\":\"invalid_request_error\",\"message\":\"rate limited\"}}"));
		this.answers.put("GET /v1/subscriptions/sub_live",
				new Answer(200, subscription("sub_live", "active")));

		drain();

		assertThat(this.queue.outstanding(10)).map(OutstandingCleanup::stripeId).containsExactly("sub_live");
	}

	/**
	 * A refused call does not take the rest of the run with it, which is the whole reason the queue is one row
	 * per Stripe object rather than one per deleted tier.
	 */
	@Test
	void andOneStuckObjectDoesNotBlockTheWorkBehindIt() {
		this.queue.add(StripeCleanup.CANCEL_SUBSCRIPTION, "sub_stuck");
		this.queue.add(StripeCleanup.ARCHIVE_PRODUCT, "prod_pro");
		this.answers.put("DELETE /v1/subscriptions/sub_stuck",
				new Answer(400, "{\"error\":{\"type\":\"invalid_request_error\",\"message\":\"nope\"}}"));
		// Answered without a `status` on purpose: a subscription Stripe describes in terms this build cannot
		// read is one the drain must leave outstanding rather than throw over — and `Set.of(…).contains(null)`
		// throws, which would take the whole run down instead of this one row.
		this.answers.put("GET /v1/subscriptions/sub_stuck",
				new Answer(200, "{\"id\":\"sub_stuck\",\"object\":\"subscription\"}"));

		drain();

		assertThat(this.queue.outstanding(10)).map(OutstandingCleanup::stripeId).containsExactly("sub_stuck");
	}

	/** And nothing outstanding is no calls at all, rather than an empty run that still asked Stripe something. */
	@Test
	void anEmptyQueueAsksStripeNothing() {
		drain();

		assertThat(this.made).isEmpty();
	}

	/**
	 * An unconfigured Stripe leaves the work outstanding rather than losing it.
	 *
	 * <p>Every developer's stack has no API key, so this is the ordinary local state and not a failure — and
	 * the rows staying outstanding is the truthful answer: nothing has been torn down.
	 */
	@Test
	void andAStripeNobodyConfiguredLeavesTheWorkWhereItIs() {
		this.queue.add(StripeCleanup.ARCHIVE_PRODUCT, "prod_pro");

		new TearDownDeletedTiers(new StripeAccount(""), this.queue, 25).makeStripeAgreeWithTheCatalog();

		assertThat(this.queue.outstanding(10)).hasSize(1);
		assertThat(this.made).isEmpty();
	}

	// --- the collaborators, by hand ---------------------------------------------------------------------------

	private void drain() {
		new TearDownDeletedTiers(new StripeAccount(StripeClient.builder()
				.setApiKey("sk_test_not_a_real_key")
				.setApiBase("http://localhost:" + this.stripe.getAddress().getPort())
				.setMaxNetworkRetries(0)
				.build()), this.queue, 25).makeStripeAgreeWithTheCatalog();
	}

	private Call onlyCallTo(String path) {
		List<Call> calls = this.made.stream().filter(call -> call.path().equals(path)).toList();
		assertThat(calls).as("calls to %s, out of %s", path, this.made).hasSize(1);
		return calls.get(0);
	}

	/**
	 * The queue, as a list. Every method of the port and nothing else — which is what makes it a stand-in for
	 * the table rather than a second implementation of one.
	 */
	private static final class Queue implements TierTeardown {

		private final List<OutstandingCleanup> rows = new ArrayList<>();

		private final List<String> errors = new ArrayList<>();

		void add(StripeCleanup kind, String stripeId) {
			enqueue("torn-down", kind, List.of(stripeId));
		}

		@Override
		public void enqueue(String tierCode, StripeCleanup kind, List<String> stripeIds) {
			for (String stripeId : stripeIds) {
				// The partial unique index, restated: one outstanding call per Stripe object, which is what
				// makes the drain offering the same Product once per Price a no-op.
				if (this.rows.stream().noneMatch(row -> row.kind() == kind && row.stripeId().equals(stripeId))) {
					this.rows.add(new OutstandingCleanup(UUID.randomUUID(), tierCode, kind, stripeId, 0));
				}
			}
		}

		/** Not what this suite is about — {@code TierDeletionTest} owns the window this answers for. */
		@Override
		public boolean isBeingTornDown(String tierCode) {
			return this.rows.stream().anyMatch(row -> row.tierCode().equals(tierCode));
		}

		@Override
		public List<OutstandingCleanup> outstanding(int limit) {
			return List.copyOf(this.rows.subList(0, Math.min(limit, this.rows.size())));
		}

		@Override
		public void done(UUID call) {
			this.rows.removeIf(row -> row.id().equals(call));
		}

		@Override
		public void failed(UUID call, String why) {
			this.errors.add(why);
			this.rows.replaceAll(row -> row.id().equals(call)
					? new OutstandingCleanup(row.id(), row.tierCode(), row.kind(), row.stripeId(),
							row.attempts() + 1)
					: row);
		}

	}

	/** One request the drain made. */
	private record Call(String method, String path, Map<String, String> body) {
	}

	/** What Stripe answers for one path. */
	private record Answer(int status, String body) {
	}

	private static String subscription(String id, String status) {
		return """
				{"id":"%s","object":"subscription","status":"%s","customer":"cus_someone"}"""
				.formatted(id, status);
	}

	private static String price(String id, String product) {
		return """
				{"id":"%s","object":"price","active":false,"currency":"eur","unit_amount":999,
				 "product":"%s","metadata":{},"recurring":{"interval":"month"}}""".formatted(id, product);
	}

	/** A form-encoded body as the pairs it is, which is how Stripe's own library sends one. */
	private static Map<String, String> form(String body) {
		Map<String, String> fields = new LinkedHashMap<>();
		if (body.isBlank()) {
			return fields;
		}
		for (String pair : body.split("&")) {
			int equals = pair.indexOf('=');
			fields.put(URLDecoder.decode(pair.substring(0, equals), UTF_8),
					URLDecoder.decode(pair.substring(equals + 1), UTF_8));
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
