package com.mprelist.billing.internal;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.mprelist.billing.UntaggedPrice;
import com.stripe.StripeClient;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * Which of Stripe's Prices this catalog has never heard of, and how one is read off the wire (T53, #84).
 *
 * <p>Against the bytes on a loopback socket rather than through a mocked SDK, for {@code StripePriceCacheTest}'s
 * reason: what is actually at risk here is the field mapping and one predicate. {@code metadata.tier_code} is
 * nested, a Price with no {@code recurring} block is a one-off rather than a plan, and a mocked
 * {@code prices().list} would assert that our own mock was called and pass with every one of them upside down.
 *
 * <p>The predicate is the sharper half: it decides what an operator is <em>shown</em>, and both ways of being
 * wrong are quiet. Listing a tagged Price sends somebody to fix a tag that is already there; hiding an
 * untagged one is the exact silence ADR-0019 named as the cost of tagging and this list exists to break.
 */
class UnadoptedPriceTest {

	private HttpServer stripe;

	/** What Stripe was asked for, decoded — the query string of the list call. */
	private String asked;

	private String answer = list(tagged("price_pro", "pro"));

	private int status = 200;

	@BeforeEach
	void startStripe() throws IOException {
		this.stripe = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
		this.stripe.createContext("/v1/prices", exchange -> {
			this.asked = exchange.getRequestURI().getQuery();
			respond(exchange, this.status, this.answer);
		});
		this.stripe.start();
	}

	@AfterEach
	void stopStripe() {
		this.stripe.stop(0);
	}

	@Test
	void aPriceThatNamesATierIsNotUnadopted() {
		// A tagged Price always has a row somewhere — the sync drafts one for a code nothing recognises
		// (ADR-0019) — so it belongs in the tier list rather than in this one.
		assertThat(untagged()).contains(List.of());
	}

	@Test
	void whileOneThatNamesNothingIs() {
		this.answer = list(untaggedJson("price_loose", "A loose end", 1500, "month"));

		assertThat(untagged()).contains(List.of(new UntaggedPrice("price_loose", "A loose end", 1500, "eur",
				"month")));
	}

	/**
	 * A tag somebody cleared in the dashboard is a tag that is not there. Treating the empty string as a code
	 * would hide the Price from this list while adopting nothing — the worst of both.
	 */
	@Test
	void andSoIsOneWhoseTagWasEmptied() {
		this.answer = list("""
				{"id":"price_blank","object":"price","active":true,"currency":"eur","unit_amount":999,
				 "metadata":{"tier_code":"   "},"recurring":{"interval":"month"}}""");

		assertThat(untagged()).map(prices -> prices.getFirst().id()).contains("price_blank");
	}

	@Test
	void andSoIsOneCarryingNoMetadataAtAll() {
		this.answer = list("""
				{"id":"price_bare","object":"price","active":true,"currency":"eur","unit_amount":500,
				 "recurring":{"interval":"year"}}""");

		assertThat(untagged()).map(prices -> prices.getFirst().id()).contains("price_bare");
	}

	/**
	 * A one-off is listed with no interval, which is usually the field that says "this was never going to be a
	 * plan" — a subscription tier has to recur. Shown rather than filtered, because deciding it is an
	 * experiment is the operator's call and not ours.
	 */
	@Test
	void aOneOffIsListedWithNothingToRecur() {
		this.answer = list("""
				{"id":"price_once","object":"price","active":true,"currency":"eur","unit_amount":2500}""");

		assertThat(untagged()).contains(List.of(new UntaggedPrice("price_once", null, 2500, "eur", null)));
	}

	/** And a Price whose amount Stripe does not state — tiered pricing — is a row rather than a crash. */
	@Test
	void andOneWithNoSingleAmountIsStillSomethingToShow() {
		this.answer = list("""
				{"id":"price_tiered","object":"price","active":true,"currency":"eur",
				 "billing_scheme":"tiered","recurring":{"interval":"month"}}""");

		assertThat(untagged()).contains(List.of(new UntaggedPrice("price_tiered", null, 0, "eur", "month")));
	}

	@Test
	void theTaggedAndTheUntaggedComeBackSortedOutFromEachOther() {
		this.answer = list(tagged("price_pro", "pro"), untaggedJson("price_loose", null, 100, "month"),
				tagged("price_power", "power"));

		assertThat(untagged()).map(prices -> prices.stream().map(UntaggedPrice::id).toList())
				.contains(List.of("price_loose"));
	}

	/** Only Prices somebody could still buy: an archived one is not a candidate for a tier. */
	@Test
	void andStripeIsOnlyAskedForTheActiveOnes() {
		untagged();

		assertThat(this.asked).contains("active=true");
	}

	// --- when there is no answer -----------------------------------------------------------------------------

	@Test
	void anEmptyAccountIsAnAnswerAndNotAFailure() {
		// Every Price tagged is the *good* state. Reporting it as unavailable would send an operator hunting
		// for a fault that is not there.
		this.answer = list();

		assertThat(untagged()).contains(List.of());
	}

	@Test
	void whileAStripeThatWillNotAnswerIsNoAnswerAtAll() {
		this.status = 500;
		this.answer = "{\"error\":{\"message\":\"no\"}}";

		assertThat(untagged()).isEmpty();
	}

	@Test
	void andSoIsAStripeNobodyConfigured() {
		assertThat(new UnadoptedStripePrices(new StripeAccount("")).untagged()).isEmpty();
	}

	// --- the collaborators, by hand ---------------------------------------------------------------------------

	private Optional<List<UntaggedPrice>> untagged() {
		return new UnadoptedStripePrices(new StripeAccount(StripeClient.builder()
				.setApiKey("sk_test_not_a_real_key")
				.setApiBase("http://localhost:" + this.stripe.getAddress().getPort())
				.setMaxNetworkRetries(0)
				.build())).untagged();
	}

	private static String tagged(String id, String tierCode) {
		return """
				{"id":"%s","object":"price","active":true,"currency":"eur","unit_amount":999,
				 "metadata":{"tier_code":"%s"},"recurring":{"interval":"month"}}""".formatted(id, tierCode);
	}

	private static String untaggedJson(String id, String nickname, long amount, String interval) {
		return """
				{"id":"%s","object":"price","active":true,"currency":"eur","unit_amount":%d,
				 "nickname":%s,"metadata":{},"recurring":{"interval":"%s"}}"""
				.formatted(id, amount, nickname == null ? "null" : "\"" + nickname + "\"", interval);
	}

	private static String list(String... prices) {
		return "{\"object\":\"list\",\"url\":\"/v1/prices\",\"has_more\":false,\"data\":["
				+ String.join(",", prices) + "]}";
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
