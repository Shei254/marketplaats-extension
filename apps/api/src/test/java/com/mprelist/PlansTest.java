package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
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

import com.mprelist.billing.StripePaymentMethods;
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

	/** What the dashboard is pretending to offer. Emptied by the test about Stripe not answering (T65, #137). */
	private static final List<String> METHODS = new ArrayList<>();

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
		TierPrices.nothingIsPriced(this.db);
		// The Catalog order restored to the seed's own (T75, #164): it is an operator's to change, this suite
		// shares a database with whichever others share its configuration, and one of those is
		// `AdminTierTest`, whose whole business is changing it.
		this.db.update("update tier set position = case code when 'free' then 1 when 'pro' then 2 else 3 end");
		this.db.update("update tier set relist_quota_per_period = 50 where code = 'pro'");
		this.db.update("update tier set relist_quota_per_period = 200 where code = 'power'");
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro");
		TierPrices.soldByTheMonth(this.db, "power", "price_power");
		this.db.update("update tier set published = true where code in ('pro', 'power')");
		// The seed's free tier, as T84's cases below leave it otherwise: the default, and granting 3.
		this.db.update("update tier set is_default = false where code <> 'free'");
		this.db.update("update tier set is_default = true, relist_quota_per_period = 3 where code = 'free'");
		PRICES.clear();
		PRICES.put("price_pro", new StripePrice(999, "eur", "month"));
		PRICES.put("price_power", new StripePrice(1999, "eur", "month"));
		METHODS.clear();
		METHODS.addAll(List.of("ideal", "paypal", "card"));
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
		assertThat(pro.get("prices").get(0).get("amount").asInt()).isEqualTo(999);
		assertThat(pro.get("prices").get(0).get("currency").asString()).isEqualTo("eur");
		assertThat(pro.get("prices").get(0).get("interval").asString()).isEqualTo("month");
	}

	/**
	 * The cards are in the <strong>Catalog order</strong> — the sequence an operator set in {@code /admin}
	 * (T75, #164; ADR-0030), of which this is the published subsequence.
	 *
	 * <p>Still one rendering decision made as an {@code order by} rather than three times as a sort in three
	 * clients. What changed in T75 is who decides: it was {@code relist_quota_per_period, code} — cheapest
	 * grant first — which nobody chose, and which cannot say which plan an operator wants bought.
	 */
	@Test
	void andComesBackInTheOrderTheCatalogIsHeldIn() {
		assertThat(codesOnOffer()).containsExactly("pro", "power");
	}

	/**
	 * And moving a tier in the catalog moves its card, which is the whole of what T75 buys a buyer.
	 *
	 * <p>Written against the column rather than through {@code PUT /api/admin/tiers/order}, because what this
	 * suite is about is the route below it: that the operator's screen writes these numbers is
	 * {@code AdminTierTest}'s, and a test here that went through the admin API would fail for two reasons at
	 * once.
	 */
	@Test
	void andMovingATierInTheCatalogMovesItsCard() {
		this.db.update("update tier set position = 1 where code = 'power'");
		this.db.update("update tier set position = 2 where code = 'pro'");

		assertThat(codesOnOffer()).containsExactly("power", "pro");
	}

	/**
	 * The free tier and every draft carry a place too, and it costs the cards nothing: this list is the
	 * published subsequence, so a free tier dragged to the top of the admin table is still not a plan.
	 */
	@Test
	void andATierNoBuyerSeesTakesUpNoPlaceOnTheCards() {
		this.db.update("update tier set position = 1 where code = 'free'");
		this.db.update("update tier set position = 2 where code = 'pro'");
		this.db.update("update tier set position = 3 where code = 'power'");

		assertThat(codesOnOffer()).containsExactly("pro", "power");
	}

	/**
	 * A tier with no cap renders as one, and the card carries {@code null} rather than a large number
	 * (T73, #160; ADR-0029) — the popup then says "Unlimited reposts" where the others say "50 reposts a
	 * month".
	 *
	 * <p>It is last here because that is where the catalog holds it (T75) and no longer because Postgres
	 * sorts nulls last in an ascending order — which is what put it there while the clause was
	 * {@code relist_quota_per_period, code}, and is a dated fact about a clause that has been replaced. An
	 * unlimited tier now sits wherever an operator put it, which may be first.
	 */
	@Test
	void andATierWithNoCapCarriesNoNumber() {
		this.db.update("update tier set relist_quota_per_period = null where code = 'power'");

		JsonNode plans = Json.of(get()).get("plans");

		assertThat(codesOnOffer()).containsExactly("pro", "power");
		assertThat(plans.get(1).get("relistQuotaPerPeriod").isNull()).isTrue();
		assertThat(plans.get(0).get("relistQuotaPerPeriod").asInt()).isEqualTo(50);
	}

	/**
	 * And a tier granting nothing cannot be one of these, because it cannot be published at all — the other
	 * half of the rule V9 added, asserted here for the reason the price one below it is: it is why
	 * {@code published()} reads one column rather than three.
	 */
	@Test
	void andATierGrantingNothingCannotEvenBePublished() {
		this.db.update("update tier set published = false where code = 'power'");
		this.db.update("update tier set relist_quota_per_period = 0 where code = 'power'");

		assertThatThrownBy(() -> this.db.update("update tier set published = true where code = 'power'"))
				.hasMessageContaining("tier_is_published_only_when_it_grants_something");
		assertThat(codesOnOffer()).containsExactly("pro");
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

	// --- the Free tier on offer (T84) -----------------------------------------------------------------------

	/**
	 * Beside the cards and never among them: a Plan always has a price, and this is the one tier that cannot.
	 * What a visitor is promised is what they would land on by signing in, so it is the grant as stored.
	 */
	@Test
	void theFreeTierOnOfferComesBesideTheCards() {
		JsonNode free = Json.of(get()).get("freeTier");

		assertThat(free.get("tier").get("code").asString()).isEqualTo("free");
		assertThat(free.get("relistQuotaPerPeriod").asInt()).isEqualTo(3);
		assertThat(free.get("features").isObject()).isTrue();
		assertThat(free.has("prices")).isFalse();
	}

	/** ADR-0019's "there is no free tier" is a default at `0`, and it promises nothing. */
	@Test
	void butAFreeTierWithdrawnToNothingIsNotOnOffer() {
		this.db.update("update tier set relist_quota_per_period = 0 where code = 'free'");

		assertThat(Json.of(get()).get("freeTier").isNull()).isTrue();
	}

	/** Nor is one nobody lands on: new accounts go to the default, and here that is a tier with a price. */
	@Test
	void norIsOneThatIsNotWhereNewAccountsLand() {
		this.db.update("update tier set is_default = false where code = 'free'");
		this.db.update("update tier set is_default = true where code = 'pro'");

		assertThat(Json.of(get()).get("freeTier").isNull()).isTrue();
	}

	/** Unlimited is `null` here as everywhere (ADR-0029), and an unlimited free tier is very much on offer. */
	@Test
	void whileAnUnlimitedOneIsOnOfferWithNoNumber() {
		this.db.update("update tier set relist_quota_per_period = null where code = 'free'");

		JsonNode free = Json.of(get()).get("freeTier");
		assertThat(free.get("tier").get("code").asString()).isEqualTo("free");
		assertThat(free.get("relistQuotaPerPeriod").isNull()).isTrue();
	}

	/**
	 * Nor is a draft — the row ADR-0019's webhook creates at quota 0 for a Price nobody has decided about
	 * (T51, #82). It has a price id, so `published` is the only thing keeping it off the screen.
	 */
	@Test
	void norIsADraftNobodyHasPublished() {
		this.db.update("insert into tier (code, name, relist_quota_per_period, max_marktplaats_accounts, "
				+ "published) values ('starter', 'starter', 0, 1, false)");
		TierPrices.soldByTheMonth(this.db, "starter", "price_starter");
		PRICES.put("price_starter", new StripePrice(499, "eur", "month"));

		assertThat(codesOnOffer()).containsExactly("pro", "power");
	}

	/**
	 * And a tier with nothing to charge against cannot be on sale either — but the query does not have to say
	 * so, because the schema will not let the row exist: V5 made a published tier with no price unwriteable
	 * (T51, #82), and V7 kept that as a trigger when the prices moved to a table of their own (T62, #128).
	 *
	 * <p>Asserted here rather than left implied, because it is the reason `published()` reads one column
	 * instead of two. A mutation that drops a redundant clause is one no test can catch, and the answer to
	 * that is to drop the clause and pin the thing that actually holds — not to keep both and hope.
	 */
	@Test
	void aTierWithNothingToChargeAgainstCannotEvenBePublished() {
		assertThatThrownBy(() -> this.db.update(
				"delete from tier_price using tier where tier.id = tier_price.tier_id and tier.code = 'power'"))
				.hasMessageContaining("tier_is_published_only_with_a_price");

		assertThat(codesOnOffer()).containsExactly("pro", "power");
	}

	/**
	 * A catalog priced in two currencies is refused whole (T63, #129).
	 *
	 * <p>A plan screen is a comparison, and €9,99 against $12.99 is not one a buyer can make without knowing
	 * today's rate — so it is the same all-or-nothing rule a price that could not be fetched meets. Nothing
	 * this API offers can produce one: no request carries a currency and every plan is created in the
	 * account's own. The way here is a Price made in the Stripe dashboard and priced in something else.
	 */
	@Test
	void aCatalogPricedInTwoCurrenciesIsNotAScreenAnybodyCanCompare() {
		PRICES.put("price_power", new StripePrice(1999, "usd", "month"));

		HttpResponse<String> refused = get();

		assertThat(refused.statusCode()).isEqualTo(503);
		assertThat(refused.body()).isEmpty();
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

	// --- what a buyer can pay with, which fails softly instead (T65, #137) ---------------------------------

	/**
	 * The methods ride beside the plans rather than inside one: they are the Stripe account's and not any
	 * tier's, and a copy per card would be the same sentence three times.
	 */
	@Test
	void whatCanBePaidWithComesBackBesideTheCards() {
		JsonNode answer = Json.of(get());

		assertThat(answer.get("paymentMethods").size()).isEqualTo(3);
		assertThat(answer.get("paymentMethods").get(0).asString()).isEqualTo("ideal");
	}

	/**
	 * <strong>The one rule this route breaks on purpose.</strong> Everything above is all-or-nothing because
	 * the plan screen is a <em>comparison</em> and a partial one is a wrong picture. Take the payment methods
	 * away and the comparison is untouched — every plan, rhythm and amount still says what it says — so this
	 * arrives empty beside a perfectly good {@code 200} rather than turning it into a {@code 503}. Blanking a
	 * working plan screen to protect a reassurance would lose the sale it was meant to win.
	 */
	@Test
	void andAStripeThatCouldNotSayDoesNotTakeTheCardsWithIt() {
		METHODS.clear();

		HttpResponse<String> answered = get();

		assertThat(answered.statusCode()).isEqualTo(200);
		assertThat(Json.of(answered).get("plans").size()).isEqualTo(2);
		assertThat(Json.of(answered).get("paymentMethods").isEmpty()).isTrue();
	}

	/** Stripe's own spelling, unedited. What each is *called* is the popup's `waysToPay`, one layer out. */
	@Test
	void andIsStripesVocabularyRatherThanAnythingReadable() {
		METHODS.clear();
		METHODS.add("sepa_debit");

		assertThat(Json.of(get()).get("paymentMethods").get(0).asString()).isEqualTo("sepa_debit");
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

	/**
	 * The one read this API answers without a token (T58): the site's landing page shows the same cards to a
	 * visitor who has no account yet, and nothing in them is per-user. The answer is the same one the popup
	 * gets, so the two surfaces cannot show different prices.
	 */
	@Test
	void aVisitorWithNoTokenIsShownTheSameCards() {
		HttpResponse<String> anonymous = Http
				.send(HttpRequest.newBuilder(uri()).timeout(TIMEOUT).GET().build());

		assertThat(anonymous.statusCode()).isEqualTo(200);
		assertThat(Json.of(anonymous)).isEqualTo(Json.of(get()));
	}

	/**
	 * Opening the route does not stop a token that <em>is</em> presented from being checked: a caller whose
	 * token is bad hears so, rather than being quietly served as a stranger and never finding out.
	 */
	@Test
	void butATokenThatIsPresentedIsStillChecked() {
		HttpResponse<String> refused = Http.send(HttpRequest.newBuilder(uri())
				.timeout(TIMEOUT)
				.header("Authorization", "Bearer " + IDP.tokenSignedByAKeyThisIssuerNeverPublished())
				.GET()
				.build());

		assertThat(refused.statusCode()).isEqualTo(401);
	}

	/** GET only, and this path only: whatever else reaches it is the 401 every other unknown call gets. */
	@Test
	void andNothingButTheReadIsOpened() {
		HttpResponse<String> refused = Http.send(HttpRequest.newBuilder(uri())
				.timeout(TIMEOUT)
				.POST(HttpRequest.BodyPublishers.noBody())
				.build());

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

		@Bean
		@Primary
		StripePaymentMethods paymentMethods() {
			return () -> List.copyOf(METHODS);
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
