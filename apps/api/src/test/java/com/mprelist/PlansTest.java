package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.mprelist.billing.StripePrice;
import com.mprelist.billing.StripePrices;

import tools.jackson.databind.JsonNode;

/**
 * {@code GET /api/plans} — what can be bought (T49, #80).
 *
 * <p>Two halves joined: what a tier grants is ours and comes from the catalog, what it costs is Stripe's and
 * is never stored (ADR-0014/0019). Stripe is a fake bean here rather than a stub server, because what this
 * suite is about is the join and the refusals — that the real client maps Stripe's fields and remembers them
 * is {@link StripePriceCacheTest}, which is the only place that talks to something Stripe-shaped.
 *
 * <p>Over a real port, so the status and the body are the ones a client actually receives: the difference
 * between {@code 200} with an empty list and {@code 503} with nothing at all is the whole of what this route
 * has to get right, and neither is visible from a method return.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import({ PostgresFromCompose.class, PlansTest.PricesStripeDidNotHaveToBeAskedFor.class })
class PlansTest {

	private static final MintedTokens IDP = MintedTokens.servingItsKeys();

	/** What the fake answers, per price id. A test that wants a failure removes one. */
	private static final Map<String, StripePrice> PRICES = new LinkedHashMap<>();

	@DynamicPropertySource
	static void trustTheTokensThisSuiteMints(DynamicPropertyRegistry properties) {
		IDP.trustedAsTheIssuer(properties);
	}

	@AfterAll
	static void stopServingKeys() {
		IDP.close();
	}

	@BeforeEach
	void aCatalogWithTwoThingsOnSale() {
		this.db.update("delete from tier where code not in ('free', 'pro', 'power')");
		this.db.update("update tier set stripe_price_id = null, published = false");
		this.db.update("update tier set stripe_price_id = 'price_pro', published = true, "
				+ "relist_quota_per_period = 50 where code = 'pro'");
		this.db.update("update tier set stripe_price_id = 'price_power', published = true, "
				+ "relist_quota_per_period = 200 where code = 'power'");
		PRICES.clear();
		PRICES.put("price_pro", new StripePrice(999, "eur", "month"));
		PRICES.put("price_power", new StripePrice(1999, "eur", "month"));
	}

	@Test
	void whatIsOnSaleIsOurHalfJoinedWithStripes() {
		JsonNode plans = Json.of(get()).get("plans");

		assertThat(plans.size()).isEqualTo(2);
		JsonNode pro = plans.get(0);
		assertThat(pro.get("tier").get("code").asString()).isEqualTo("pro");
		assertThat(pro.get("tier").get("name").asString()).isEqualTo("Pro");
		assertThat(pro.get("relistQuotaPerPeriod").asInt()).isEqualTo(50);
		assertThat(pro.get("features").isObject()).isTrue();
		assertThat(pro.get("price").get("amount").asInt()).isEqualTo(999);
		assertThat(pro.get("price").get("currency").asString()).isEqualTo("eur");
		assertThat(pro.get("price").get("interval").asString()).isEqualTo("month");
	}

	@Test
	void andComesBackCheapestFirst() {
		// A rendering decision made once, as an `order by`, rather than three times as a sort in three
		// clients — and the order a buyer reads a comparison in.
		assertThat(codesOnOffer()).containsExactly("pro", "power");
	}

	/**
	 * The free tier is not something a buyer chooses, and it is excluded by the thing that makes it free: it
	 * has no Stripe Price. Asserted rather than assumed, because a card for it would be a button that opens a
	 * Checkout for nothing.
	 */
	@Test
	void theFreeTierIsNotOnSale() {
		assertThat(codesOnOffer()).doesNotContain("free");
	}

	/**
	 * Nor is a draft — the row ADR-0019's webhook creates at quota 0 for a Price nobody has decided about
	 * (T51, #82). It has a price id, so `published` is the only thing keeping it off the screen.
	 */
	@Test
	void norIsADraftNobodyHasPublished() {
		this.db.update("insert into tier (code, name, relist_quota_per_period, max_marktplaats_accounts, "
				+ "stripe_price_id, published) values ('starter', 'starter', 0, 1, 'price_starter', false)");
		PRICES.put("price_starter", new StripePrice(499, "eur", "month"));

		assertThat(codesOnOffer()).containsExactly("pro", "power");
	}

	/**
	 * And a tier with nothing to charge against cannot be on sale either — but the query does not have to say
	 * so, because the schema will not let the row exist: `V5__tier_publication.sql` makes a published tier
	 * with no price unwriteable (T51, #82).
	 *
	 * <p>Asserted here rather than left implied, because it is the reason `published()` reads one column
	 * instead of two. A mutation that drops a redundant clause is one no test can catch, and the answer to
	 * that is to drop the clause and pin the thing that actually holds — not to keep both and hope.
	 */
	@Test
	void aTierWithNothingToChargeAgainstCannotEvenBePublished() {
		assertThatThrownBy(() -> this.db.update("update tier set stripe_price_id = null where code = 'power'"))
				.hasMessageContaining("tier_is_published_only_with_a_price");

		assertThat(codesOnOffer()).containsExactly("pro", "power");
	}

	@Test
	void aCatalogWithNothingPublishedIsAnAnswerRatherThanAFault() {
		// Which is every stack whose Stripe Prices have not been created yet (T22, #28). "Unavailable" would
		// report a fault that is not there.
		this.db.update("update tier set published = false");

		HttpResponse<String> answered = get();

		assertThat(answered.statusCode()).isEqualTo(200);
		assertThat(Json.of(answered).get("plans").isEmpty()).isTrue();
	}

	// --- fail-closed, which applies to display ------------------------------------------------------------

	/**
	 * A price Stripe could not give takes the whole page with it. The alternative — render the ones that
	 * resolved — is worse: a plan screen is a comparison, and a buyer cannot tell a plan that is missing from
	 * a plan that does not exist.
	 */
	@Test
	void aPriceThatCouldNotBeFetchedIsNotAPartialList() {
		PRICES.remove("price_power");

		HttpResponse<String> refused = get();

		assertThat(refused.statusCode()).isEqualTo(503);
		assertThat(refused.body()).isEmpty();
	}

	@Test
	void andNeverAFreePlanOrAGuessedAmount() {
		// The failure the contract names: never a card whose button would open a Checkout for an amount we
		// invented. Asserted as the absence of a body at all, since anything parseable would be something a
		// client could render.
		PRICES.clear();

		HttpResponse<String> refused = get();

		assertThat(refused.statusCode()).isEqualTo(503);
		assertThat(refused.body()).doesNotContain("plans").isEmpty();
	}

	@Test
	void andItIsClosedLikeEveryOtherRoute() {
		// Nothing here is per-user, which is not a reason to open one route in an API that is closed by
		// default: the caller is the popup, and it is holding a token already.
		HttpResponse<String> refused = Http
				.send(HttpRequest.newBuilder(uri()).timeout(TIMEOUT).GET().build());

		assertThat(refused.statusCode()).isEqualTo(401);
	}

	// --- the suite's own machinery -------------------------------------------------------------------------

	/** Stripe, as a bean. `@Primary` so it is what `PlansOnOffer` is given rather than the real client. */
	@TestConfiguration(proxyBeanMethods = false)
	static class PricesStripeDidNotHaveToBeAskedFor {

		@Bean
		@Primary
		StripePrices prices() {
			return id -> Optional.ofNullable(PRICES.get(id));
		}

	}

	private java.util.List<String> codesOnOffer() {
		JsonNode plans = Json.of(get()).get("plans");
		return java.util.stream.StreamSupport.stream(plans.spliterator(), false)
				.map(plan -> plan.get("tier").get("code").asString())
				.toList();
	}

	private HttpResponse<String> get() {
		return Http.send(HttpRequest.newBuilder(uri())
				.timeout(TIMEOUT)
				.header("Authorization", "Bearer " + IDP.token())
				.GET()
				.build());
	}

	private URI uri() {
		return URI.create("http://localhost:" + this.port + "/api/plans");
	}

	@LocalServerPort
	private int port;

	@Autowired
	private JdbcTemplate db;

	private static final Duration TIMEOUT = Duration.ofSeconds(20);

}
