package com.mprelist;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.mprelist.Subscribers.Subscriber;

import tools.jackson.databind.JsonNode;

/**
 * The tier catalog as an operator works on it (T53, #84): what they see, what they may change, and the two
 * things the API will not let them do.
 *
 * <p><strong>Over a real port and against a real Postgres</strong>, because most of what this ticket is lives
 * in the two: the {@code ADMIN} guard is a filter chain ({@link AdminGuardTest}'s reason), and "moving the
 * default flag leaves exactly one" is a claim about a partial unique index rather than about any Java.
 *
 * <p><strong>No Stripe key is configured</strong>, which is what makes the last section — the unadopted Price
 * list — assertable at all: an unconfigured key is the same answer as an unreachable Stripe, and that answer
 * is the one worth pinning. What a real Price list looks like is {@code UnadoptedPriceTest}, against a stub on
 * a loopback port.
 *
 * <p>The reconciliation job is switched off for {@link DisplayStateTest}'s reason: one test below holds units
 * in an open window and then lowers the quota under them, and a job handing those back would be answering a
 * different question.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "mprelist.stripe.secret-key=", "mprelist.reconciliation.interval=24h" })
@Import(PostgresFromCompose.class)
class AdminTierTest {

	private static final MintedTokens IDP = MintedTokens.servingItsKeys();

	@DynamicPropertySource
	static void trustTheTokensThisSuiteMints(DynamicPropertyRegistry properties) {
		IDP.trustedAsTheIssuer(properties);
	}

	@AfterAll
	static void stopServingKeys() {
		IDP.close();
	}

	/**
	 * The seeded catalog, restored — this suite shares a database with whichever others share its
	 * configuration, and both it and they edit these rows. Everything below is asserted against the three the
	 * seed leaves behind rather than against whatever the last suite happened to write.
	 */
	@BeforeEach
	void theSeededCatalogAndNothingElse() {
		this.rows = new Subscribers(this.db, IDP, "admin-suite-");
		this.rows.nobodyHasRelistedYet();
		this.db.update("delete from tier where code not in ('free', 'pro', 'power')");
		this.db.update("update tier set stripe_price_id = null, published = false, features = '{}'::jsonb");
		// Clear then set, in two statements, for the reason `makeDefault` gives: `tier_single_default` is a
		// plain partial unique index and is checked row by row, so the one-statement form this used to be
		// fails on a duplicate that never outlives the statement — which is exactly what it did, the moment a
		// test that moves the flag happened to run before one that reads it.
		this.db.update("update tier set is_default = false where is_default");
		this.db.update("update tier set is_default = true where code = 'free'");
		this.db.update("update tier set relist_quota_per_period = 3 where code = 'free'");
		this.db.update("update tier set relist_quota_per_period = 50, name = 'Pro' where code = 'pro'");
	}

	// --- what an operator sees ------------------------------------------------------------------------------

	@Test
	void theListIsEveryTierThereIs() {
		JsonNode tiers = Json.of(get(TIERS)).get("tiers");

		assertThat(codesIn(tiers)).containsExactly("free", "pro", "power");
	}

	/**
	 * Including the two every other view hides: a draft, which the sync creates at quota 0 for a Price nobody
	 * has decided about (ADR-0019), and the free tier, which is never sellable and is very much editable. An
	 * operator who could not see a draft could not act on the one thing this screen exists for.
	 */
	@Test
	void includingTheDraftsAndTheFreeTierNobodyCanBuy() {
		this.db.update("insert into tier (code, name, relist_quota_per_period, max_marktplaats_accounts, "
				+ "stripe_price_id, published) values ('starter', 'starter', 0, 1, 'price_starter', false)");

		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).contains("starter", "free");
	}

	@Test
	void andCarriesWhatTheOperatorDecidesAboutEachOne() {
		JsonNode pro = tierNamed("pro");

		assertThat(pro.get("tier").get("code").asString()).isEqualTo("pro");
		assertThat(pro.get("tier").get("name").asString()).isEqualTo("Pro");
		assertThat(pro.get("relistQuotaPerPeriod").asInt()).isEqualTo(50);
		assertThat(pro.get("published").asBoolean()).isFalse();
		assertThat(pro.get("isDefault").asBoolean()).isFalse();
		assertThat(pro.get("features").isObject()).isTrue();
	}

	/**
	 * And the Price, which is a fact to read rather than a field to edit: the link between the two systems is
	 * the tag on the Price in Stripe (ADR-0019), so this is how an operator sees whether the sync has found it.
	 */
	@Test
	void andWhetherStripeHasAPriceForIt() {
		assertThat(tierNamed("pro").get("stripePriceId").isNull()).isTrue();

		this.db.update("update tier set stripe_price_id = 'price_pro' where code = 'pro'");

		assertThat(tierNamed("pro").get("stripePriceId").asString()).isEqualTo("price_pro");
	}

	/** No amount on any of them: money is Stripe's, and this screen has to be readable when Stripe is not. */
	@Test
	void butNeverWhatItCosts() {
		assertThat(tierNamed("pro").has("price")).isFalse();
		assertThat(tierNamed("pro").has("amount")).isFalse();
	}

	// --- what they may change -------------------------------------------------------------------------------

	@Test
	void anEditChangesTheQuotaTheNameAndTheFlags() {
		HttpResponse<String> edited = put("/api/admin/tiers/pro",
				"{\"name\":\"Pro plus\",\"relistQuotaPerPeriod\":75,\"features\":{\"bulk\":true},"
						+ "\"published\":false}");

		assertThat(edited.statusCode()).isEqualTo(200);
		JsonNode pro = tierNamed("pro");
		assertThat(pro.get("tier").get("name").asString()).isEqualTo("Pro plus");
		assertThat(pro.get("relistQuotaPerPeriod").asInt()).isEqualTo(75);
		assertThat(pro.get("features").get("bulk").asBoolean()).isTrue();
	}

	/** And answers with the row as stored, not the request echoed back — the code and the Price came from us. */
	@Test
	void andAnswersWithTheRowRatherThanTheRequest() {
		this.db.update("update tier set stripe_price_id = 'price_pro' where code = 'pro'");

		JsonNode answered = Json.of(put("/api/admin/tiers/pro", edit(20, true)));

		assertThat(answered.get("tier").get("code").asString()).isEqualTo("pro");
		assertThat(answered.get("stripePriceId").asString()).isEqualTo("price_pro");
		assertThat(answered.get("isDefault").asBoolean()).isFalse();
	}

	/**
	 * And the flags come back as the <em>column</em> holds them rather than as they were sent, which is the
	 * sharpest evidence available that this answer is a read.
	 *
	 * <p>{@code jsonb} does not keep the key order it was given — it orders by length and then bytewise — so a
	 * route echoing the request back would hand a client something that disagrees with the very next
	 * {@code GET}. There is nothing wrong with either order; what matters is that one of them is what is
	 * stored, and that is the one an operator's screen should be drawing.
	 */
	@Test
	void andTheFlagsComeBackAsTheColumnHoldsThem() {
		JsonNode answered = Json.of(put("/api/admin/tiers/pro",
				"{\"name\":\"Pro\",\"relistQuotaPerPeriod\":50,\"features\":{\"zzz\":1,\"a\":2,\"mm\":3},"
						+ "\"published\":false}"));

		assertThat(answered.get("features").toString()).isEqualTo("{\"a\":2,\"mm\":3,\"zzz\":1}");
	}

	/** The code is the stable handle and an edit never moves it — everything references a tier through it. */
	@Test
	void andNeverTheCode() {
		put("/api/admin/tiers/pro", "{\"code\":\"professional\",\"name\":\"Pro\","
				+ "\"relistQuotaPerPeriod\":50,\"features\":{},\"published\":false}");

		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).containsExactly("free", "pro", "power");
	}

	/** Nor the Stripe Price, which nobody types anywhere: the tag on the Price is the only link (ADR-0019). */
	@Test
	void andNeverTheStripePrice() {
		this.db.update("update tier set stripe_price_id = 'price_pro' where code = 'pro'");

		put("/api/admin/tiers/pro", "{\"name\":\"Pro\",\"relistQuotaPerPeriod\":50,\"features\":{},"
				+ "\"published\":false,\"stripePriceId\":\"price_somebody_typed\"}");

		assertThat(tierNamed("pro").get("stripePriceId").asString()).isEqualTo("price_pro");
	}

	@Test
	void aTierNobodyStoredIsNotOneToEdit() {
		HttpResponse<String> refused = put("/api/admin/tiers/nonesuch", edit(10, false));

		assertThat(refused.statusCode()).isEqualTo(404);
		assertThat(refused.body()).isEmpty();
	}

	// --- publishing -----------------------------------------------------------------------------------------

	@Test
	void aTierWithAPriceCanBePutOnSaleAndTakenBackOff() {
		this.db.update("update tier set stripe_price_id = 'price_pro' where code = 'pro'");

		assertThat(put("/api/admin/tiers/pro", edit(50, true)).statusCode()).isEqualTo(200);
		assertThat(tierNamed("pro").get("published").asBoolean()).isTrue();

		assertThat(put("/api/admin/tiers/pro", edit(50, false)).statusCode()).isEqualTo(200);
		assertThat(tierNamed("pro").get("published").asBoolean()).isFalse();
	}

	/**
	 * Publishing a tier with nothing to charge against is refused, and the refusal is the one thing this route
	 * conflicts over. Answered rather than thrown: {@code tier_is_published_only_with_a_price} would take the
	 * row anyway, as a `500` where what is wanted is an operator being told to go and create a Price.
	 */
	@Test
	void butATierWithNoPriceCannotBePutOnSaleAtAll() {
		HttpResponse<String> refused = put("/api/admin/tiers/pro", edit(50, true));

		assertThat(refused.statusCode()).isEqualTo(409);
		assertThat(refused.body()).isEmpty();
	}

	/** And nothing else in the row moved either — a refused edit is not a partial one. */
	@Test
	void andTheRefusedEditChangedNothing() {
		put("/api/admin/tiers/pro", "{\"name\":\"Renamed\",\"relistQuotaPerPeriod\":999,\"features\":{},"
				+ "\"published\":true}");

		JsonNode pro = tierNamed("pro");
		assertThat(pro.get("tier").get("name").asString()).isEqualTo("Pro");
		assertThat(pro.get("relistQuotaPerPeriod").asInt()).isEqualTo(50);
	}

	// --- which tier new accounts start on ---------------------------------------------------------------------

	@Test
	void theDefaultMovesRatherThanToggling() {
		assertThat(put("/api/admin/tiers/pro/default", null).statusCode()).isEqualTo(200);

		assertThat(defaultTiers()).containsExactly("pro");
	}

	/**
	 * Which is the whole design of it: there is no request that leaves the catalog without one. A catalog with
	 * no default takes down every new sign-in — {@code TierCatalog.defaultTier()} throws and
	 * {@code ProvisionOnFirstLogin} catches nothing — and the operator who caused it would see nothing wrong.
	 */
	@Test
	void andThereIsNoWayToAskForACatalogWithNoDefaultAtAll() {
		put("/api/admin/tiers/pro/default", null);
		put("/api/admin/tiers/power/default", null);
		put("/api/admin/tiers/free/default", null);

		assertThat(defaultTiers()).hasSize(1);
	}

	/** Naming the tier that already holds it changes nothing, so a form is safe to submit twice. */
	@Test
	void andNamingTheOneThatAlreadyHasItIsANoOp() {
		assertThat(put("/api/admin/tiers/free/default", null).statusCode()).isEqualTo(200);

		assertThat(defaultTiers()).containsExactly("free");
	}

	@Test
	void aTierNobodyStoredCannotBecomeTheDefault() {
		HttpResponse<String> refused = put("/api/admin/tiers/nonesuch/default", null);

		assertThat(refused.statusCode()).isEqualTo(404);
		assertThat(defaultTiers()).containsExactly("free");
	}

	/**
	 * "No free tier" is a quota of zero on the default tier rather than a catalog without one (ADR-0019).
	 * Every new user is still provisioned; what changes is that they have nothing to spend.
	 */
	@Test
	void andNoFreeTierIsAQuotaOfZeroOnTheDefaultOne() {
		assertThat(put("/api/admin/tiers/free", edit(0, false)).statusCode()).isEqualTo(200);

		assertThat(tierNamed("free").get("relistQuotaPerPeriod").asInt()).isZero();
		assertThat(defaultTiers()).containsExactly("free");
	}

	// --- what it does to the people already on it -------------------------------------------------------------

	/**
	 * Lowering a quota under existing subscribers is allowed, changes no subscriber's row, and clamps what is
	 * left at zero (ADR-0014, amended). No proration and no notification: what remains is the grant minus what
	 * has been spent, so the arithmetic follows the edit by itself.
	 */
	@Test
	void loweringAQuotaUnderSubscribersLeavesThemWithNoneRatherThanWithLessThanNone() {
		Subscriber user = this.rows.entitledTo(3);
		String code = (String) this.rows.tierOf(user).get("code");
		this.rows.unitHeldBy(user, Subscribers.now().minusMinutes(1));
		this.rows.unitHeldBy(user, Subscribers.now().minusMinutes(1));

		assertThat(put("/api/admin/tiers/" + code, edit(1, false)).statusCode()).isEqualTo(200);

		assertThat(quotaRemainingOf(user)).isZero();
	}

	/** And raising it is felt immediately, by the same arithmetic and with nothing written to their row. */
	@Test
	void andRaisingOneIsFeltWithoutTouchingAnybodysSubscription() {
		Subscriber user = this.rows.entitledTo(3);
		String code = (String) this.rows.tierOf(user).get("code");
		this.rows.unitHeldBy(user, Subscribers.now().minusMinutes(1));

		put("/api/admin/tiers/" + code, edit(10, false));

		assertThat(quotaRemainingOf(user)).isEqualTo(9);
	}

	// --- bodies this API will not take -------------------------------------------------------------------------

	@Test
	void anEditThatLeavesOutAFieldItCouldChangeIsNotOne() {
		// Guessing either would change a plan nobody asked to change: a missing `published` would unpublish it
		// and a missing quota would strip it.
		assertThat(put("/api/admin/tiers/pro", "{\"name\":\"Pro\",\"features\":{}}").statusCode()).isEqualTo(400);
		assertThat(put("/api/admin/tiers/pro", "{\"name\":\"Pro\",\"relistQuotaPerPeriod\":5}").statusCode())
				.isEqualTo(400);
	}

	@Test
	void andNeitherIsATierCalledNothingOrOneGrantingLessThanNothing() {
		assertThat(put("/api/admin/tiers/pro", "{\"name\":\"  \",\"relistQuotaPerPeriod\":5,\"features\":{},"
				+ "\"published\":false}").statusCode()).isEqualTo(400);
		assertThat(put("/api/admin/tiers/pro", "{\"name\":\"Pro\",\"relistQuotaPerPeriod\":-1,\"features\":{},"
				+ "\"published\":false}").statusCode()).isEqualTo(400);
	}

	@Test
	void andNeitherIsSomethingThatIsNotJsonAtAll() {
		HttpResponse<String> refused = put("/api/admin/tiers/pro", "not json");

		assertThat(refused.statusCode()).isEqualTo(400);
		// Nothing to parse, which is the contract's rule for a 4xx that is not a denial.
		assertThat(refused.body()).isEmpty();
	}

	// --- who may do any of it ---------------------------------------------------------------------------------

	/**
	 * The real routes are closed to a caller without the role, not merely the fixture ones
	 * {@link AdminGuardTest} stands up. That suite proves the rule covers the path space; this proves these
	 * particular handlers are in it.
	 */
	@Test
	void noneOfThisIsReachableWithoutTheAdminRole() {
		assertThat(getAs(TIERS, IDP.token()).statusCode()).isEqualTo(403);
		assertThat(putAs("/api/admin/tiers/pro", edit(1, false), IDP.token()).statusCode()).isEqualTo(403);
		assertThat(putAs("/api/admin/tiers/pro/default", null, IDP.token()).statusCode()).isEqualTo(403);
		assertThat(getAs(PRICES, IDP.token()).statusCode()).isEqualTo(403);
	}

	@Test
	void andAnEditThatWasRefusedNeverRan() {
		putAs("/api/admin/tiers/pro", edit(999, false), IDP.token());

		assertThat(tierNamed("pro").get("relistQuotaPerPeriod").asInt()).isEqualTo(50);
	}

	// --- creating a plan without leaving the screen ---------------------------------------------------------------

	/**
	 * With no Stripe configured a plan cannot be created, and the refusal carries Stripe's own words — which
	 * is the one place in this API a {@code 4xx} says anything, because "no API key is configured" and "amount
	 * must be at least 50 cents" are the only things that tell an operator what to change.
	 */
	@Test
	void aPlanCannotBeCreatedWithoutAStripeToCreateItIn() {
		HttpResponse<String> refused = post(PLANS, newPlan("starter"));

		assertThat(refused.statusCode()).isEqualTo(422);
		assertThat(Json.of(refused).get("problem").asString()).contains("Stripe");
		// And nothing was written: a plan half-created is worse than none.
		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).doesNotContain("starter");
	}

	/**
	 * A code the catalog already holds is refused before Stripe is asked at all, and that is what makes
	 * "create" mean create. Adopting it instead would repoint the existing tier's Price — the upsert's
	 * ordinary behaviour, right for a webhook and quite wrong for a button labelled New plan.
	 */
	@Test
	void andACodeTheCatalogAlreadyHoldsIsNotANewPlan() {
		HttpResponse<String> refused = post(PLANS, newPlan("pro"));

		assertThat(refused.statusCode()).isEqualTo(409);
		assertThat(refused.body()).isEmpty();
		// Untouched — in particular its Price, which is the thing that would have moved.
		assertThat(tierNamed("pro").get("relistQuotaPerPeriod").asInt()).isEqualTo(50);
	}

	@Test
	void andABodyThatLeavesOutWhatItCostsOrWhatItGrantsIsNotOne() {
		// Guessing an amount would be inventing a price; guessing a quota would be inventing an entitlement.
		assertThat(post(PLANS, "{\"tierCode\":\"starter\",\"name\":\"Starter\",\"currency\":\"eur\","
				+ "\"interval\":\"month\",\"relistQuotaPerPeriod\":10,\"published\":true}").statusCode())
				.isEqualTo(400);
		assertThat(post(PLANS, "{\"tierCode\":\"starter\",\"name\":\"Starter\",\"amount\":500,"
				+ "\"currency\":\"eur\",\"interval\":\"month\",\"published\":true}").statusCode())
				.isEqualTo(400);
	}

	@Test
	void andNeitherIsOneNamingNoTierOrNoCurrency() {
		assertThat(post(PLANS, newPlan("")).statusCode()).isEqualTo(400);
		assertThat(post(PLANS, "{\"tierCode\":\"starter\",\"name\":\"Starter\",\"amount\":500,"
				+ "\"currency\":\"\",\"interval\":\"month\",\"relistQuotaPerPeriod\":10,"
				+ "\"published\":false}").statusCode()).isEqualTo(400);
	}

	@Test
	void andNeitherIsSomethingThatIsNotJsonAtAllEither() {
		HttpResponse<String> refused = post(PLANS, "not json");

		assertThat(refused.statusCode()).isEqualTo(400);
		assertThat(refused.body()).isEmpty();
	}

	/**
	 * The currency list is Stripe's to answer, so with none configured there is none — a {@code 503} rather
	 * than a guess, because a hardcoded list would offer currencies this account cannot settle in and the plan
	 * that resulted would render a card and fail at Checkout.
	 */
	@Test
	void andTheCurrenciesToPriceItInAreUnknownRatherThanGuessedAt() {
		HttpResponse<String> unavailable = get(CURRENCIES);

		assertThat(unavailable.statusCode()).isEqualTo(503);
		assertThat(unavailable.body()).isEmpty();
	}

	@Test
	void andNoneOfItIsReachableWithoutTheAdminRoleEither() {
		assertThat(postAs(PLANS, newPlan("starter"), IDP.token()).statusCode()).isEqualTo(403);
		assertThat(getAs(CURRENCIES, IDP.token()).statusCode()).isEqualTo(403);
	}

	// --- the Prices nobody tagged -------------------------------------------------------------------------------

	/**
	 * With no Stripe configured the list cannot be had, and that is a {@code 503} rather than an empty list —
	 * an empty list is the <em>good</em> state, so reporting an outage as one would tell an operator their
	 * catalog is complete at the moment nobody can check.
	 */
	@Test
	void theUnadoptedPriceListIsUnavailableRatherThanEmptyWhenStripeCannotBeAsked() {
		HttpResponse<String> unavailable = get(PRICES);

		assertThat(unavailable.statusCode()).isEqualTo(503);
		assertThat(unavailable.body()).isEmpty();
	}

	// --- reading the answers ------------------------------------------------------------------------------------

	private JsonNode tierNamed(String code) {
		for (JsonNode tier : Json.of(get(TIERS)).get("tiers")) {
			if (tier.get("tier").get("code").asString().equals(code)) {
				return tier;
			}
		}
		throw new IllegalStateException("No tier called " + code + " in the admin list");
	}

	private static List<String> codesIn(JsonNode tiers) {
		return tiers.valueStream().map(tier -> tier.get("tier").get("code").asString()).toList();
	}

	private List<String> defaultTiers() {
		return this.db.queryForList("select code from tier where is_default", String.class);
	}

	private int quotaRemainingOf(Subscriber user) {
		HttpResponse<String> me = Http.send(HttpRequest.newBuilder(uri("/api/me"))
				.timeout(TIMEOUT)
				.header("Authorization", "Bearer " + user.token())
				.GET()
				.build());
		return Json.of(me).get("quotaRemaining").asInt();
	}

	private static String newPlan(String code) {
		return "{\"tierCode\":\"" + code + "\",\"name\":\"Starter\",\"amount\":500,\"currency\":\"eur\","
				+ "\"interval\":\"month\",\"relistQuotaPerPeriod\":10,\"features\":{},\"published\":false}";
	}

	private static String edit(int quota, boolean published) {
		return "{\"name\":\"Pro\",\"relistQuotaPerPeriod\":" + quota + ",\"features\":{},\"published\":"
				+ published + "}";
	}

	// --- the calls themselves -------------------------------------------------------------------------------------

	private HttpResponse<String> get(String path) {
		return getAs(path, operator());
	}

	private HttpResponse<String> getAs(String path, String token) {
		return Http.send(HttpRequest.newBuilder(uri(path))
				.timeout(TIMEOUT)
				.header("Authorization", "Bearer " + token)
				.GET()
				.build());
	}

	private HttpResponse<String> post(String path, String body) {
		return postAs(path, body, operator());
	}

	private HttpResponse<String> postAs(String path, String body, String token) {
		return Http.send(HttpRequest.newBuilder(uri(path))
				.timeout(TIMEOUT)
				.header("Authorization", "Bearer " + token)
				.header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(body, UTF_8))
				.build());
	}

	private HttpResponse<String> put(String path, String body) {
		return putAs(path, body, operator());
	}

	private HttpResponse<String> putAs(String path, String body, String token) {
		HttpRequest.Builder request = HttpRequest.newBuilder(uri(path))
				.timeout(TIMEOUT)
				.header("Authorization", "Bearer " + token);
		if (body == null) {
			request.PUT(HttpRequest.BodyPublishers.noBody());
		}
		else {
			request.header("Content-Type", "application/json")
					.PUT(HttpRequest.BodyPublishers.ofString(body, UTF_8));
		}
		return Http.send(request.build());
	}

	private String operator() {
		return IDP.token(claims -> claims.claim("realm_access", Map.of("roles", List.of("ADMIN"))));
	}

	private URI uri(String path) {
		return URI.create("http://localhost:" + this.port + path);
	}

	@LocalServerPort
	private int port;

	@Autowired
	private JdbcTemplate db;

	private Subscribers rows;

	private static final String TIERS = "/api/admin/tiers";

	private static final String PRICES = "/api/admin/prices";

	private static final String PLANS = "/api/admin/plans";

	private static final String CURRENCIES = "/api/admin/currencies";

	private static final Duration TIMEOUT = Duration.ofSeconds(20);

}
