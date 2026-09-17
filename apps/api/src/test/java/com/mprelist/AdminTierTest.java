package com.mprelist;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
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
	 *
	 * <p><strong>By id rather than by code, since T76 (ADR-0031).</strong> This used to delete every row whose
	 * code was not one of the seeded three, which was the same statement for as long as a code could not move.
	 * A test that renames {@code free} to {@code gratis} now leaves a row that statement would delete — taking
	 * the free tier, the default flag and every later test's sign-in with it. The three ids are read once, on
	 * the first of these in the JVM and so before any test has renamed anything, and every run after that puts
	 * the seed's codes back on the rows that have always been them.
	 */
	@BeforeEach
	void theSeededCatalogAndNothingElse() {
		this.rows = new Subscribers(this.db, IDP, "admin-suite-");
		this.rows.nobodyHasRelistedYet();
		if (SEEDED.isEmpty()) {
			this.db.query("select id, code from tier where code in ('free', 'pro', 'power')",
					(RowCallbackHandler) row -> SEEDED.put(row.getString("code"),
							row.getObject("id", UUID.class)));
		}
		SEEDED.forEach((code, id) -> this.db.update("update tier set code = ? where id = ?", code, id));
		this.db.update("delete from tier where code not in ('free', 'pro', 'power')");
		TierPrices.nothingIsPriced(this.db);
		this.db.update("update tier set features = '{}'::jsonb");
		// Clear then set, in two statements, for the reason `makeDefault` gives: `tier_single_default` is a
		// plain partial unique index and is checked row by row, so the one-statement form this used to be
		// fails on a duplicate that never outlives the statement — which is exactly what it did, the moment a
		// test that moves the flag happened to run before one that reads it.
		this.db.update("update tier set is_default = false where is_default");
		this.db.update("update tier set is_default = true where code = 'free'");
		this.db.update("update tier set relist_quota_per_period = 3 where code = 'free'");
		this.db.update("update tier set relist_quota_per_period = 50, name = 'Pro' where code = 'pro'");
		// And the Catalog order back to the seed's own (T75, #164). It is state an operator writes, so the
		// tests below that write it have to start from somewhere stated rather than from wherever the last
		// one left the catalog.
		this.db.update("update tier set position = case code when 'free' then 1 when 'pro' then 2 else 3 end");
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
				+ "published) values ('starter', 'starter', 0, 1, false)");
		TierPrices.soldByTheMonth(this.db, "starter", "price_starter");

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
		assertThat(tierNamed("pro").get("prices")).isEmpty();

		TierPrices.soldByTheMonth(this.db, "pro", "price_pro");

		assertThat(pricesOf("pro")).containsExactly("price_pro:month");
	}

	/**
	 * And every rhythm it is sold at, since T62 (#128) — monthly and annual Pro are one plan on one row, which
	 * is the whole reason the wire carries a list where it used to carry an id.
	 */
	@Test
	void andEveryRhythmItIsSoldAt() {
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro");
		TierPrices.soldAt(this.db, "pro", "price_pro_yearly", "year");

		assertThat(pricesOf("pro")).containsExactly("price_pro:month", "price_pro_yearly:year");
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
				"{\"code\":\"pro\",\"name\":\"Pro plus\",\"relistQuotaPerPeriod\":75,\"features\":{\"bulk\":true},"
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
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro");

		JsonNode answered = Json.of(put("/api/admin/tiers/pro", edit("pro", 20, true)));

		assertThat(answered.get("tier").get("code").asString()).isEqualTo("pro");
		assertThat(answered.get("prices").get(0).get("stripePriceId").asString()).isEqualTo("price_pro");
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
				"{\"code\":\"pro\",\"name\":\"Pro\",\"relistQuotaPerPeriod\":50,\"features\":{\"zzz\":1,\"a\":2,\"mm\":3},"
						+ "\"published\":false}"));

		assertThat(answered.get("features").toString()).isEqualTo("{\"a\":2,\"mm\":3,\"zzz\":1}");
	}

	/**
	 * And the code, which is the field T76 added and the only one that is not always editable (ADR-0031).
	 *
	 * <p>Asserted on a tier with no Price because that is the condition — the seed's {@code free} row is the
	 * one that qualifies on a real deployment, and {@code nothingIsPriced} makes every row here one. What
	 * moves is the row itself: the same tier, addressed by a new handle, with its subscribers untouched
	 * because they hold a uuid.
	 */
	@Test
	void andTheCodeItselfOnATierNoPriceHasFrozen() {
		assertThat(put("/api/admin/tiers/free", renamed("gratis", "Gratis", 3)).statusCode()).isEqualTo(200);

		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).containsExactly("gratis", "pro", "power");
		assertThat(tierNamed("gratis").get("tier").get("name").asString()).isEqualTo("Gratis");
	}

	/** And the answer is the row where it now is, not a 404 for the code the request was addressed to. */
	@Test
	void andAnswersAsTheTierItNowIs() {
		JsonNode answered = Json.of(put("/api/admin/tiers/free", renamed("gratis", "Gratis", 3)));

		assertThat(answered.get("tier").get("code").asString()).isEqualTo("gratis");
		assertThat(answered.get("isDefault").asBoolean()).isTrue();
	}

	/**
	 * And nobody on it moves, which is the whole reason this is safe: a subscription holds {@code tier_id},
	 * a uuid, and {@code TierRows} looks the tier up by it — reading the code <em>out</em> of the row.
	 * {@code TierEdit} used to claim "a subscription's tier is found through it", which was false when it was
	 * written (ADR-0031).
	 */
	@Test
	void andNobodyOnItIsMovedByTheRename() {
		Subscriber user = this.rows.entitledTo(3);
		String code = (String) this.rows.tierOf(user).get("code");

		assertThat(put("/api/admin/tiers/" + code, renamed(code + "-renamed", "Renamed", 3)).statusCode())
				.isEqualTo(200);

		assertThat(displayStateOf(user).get("tier").get("code").asString()).isEqualTo(code + "-renamed");
		assertThat(quotaRemainingOf(user)).isEqualTo(3);
	}

	/**
	 * But a tier with a Price is frozen, and Stripe is the reason rather than us (ADR-0031). The Price
	 * carries the code as {@code metadata.tier_code}, which is what the sync finds the tier by — so a rename
	 * underneath it would have the next {@code price.updated} adopt the old code as a fresh draft, splitting
	 * one tier into two with the subscribers on the half nobody is looking at.
	 */
	@Test
	void butNotOnOneAPriceHasFrozen() {
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro");

		HttpResponse<String> refused = put("/api/admin/tiers/pro", renamed("professional", "Pro", 50));

		assertThat(refused.statusCode()).isEqualTo(409);
		assertThat(refused.body()).isEmpty();
		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).containsExactly("free", "pro", "power");
	}

	/** And a refused rename is not a partial edit: the name and the quota it also carried stayed put. */
	@Test
	void andTheFrozenRefusalChangedNothingElseEither() {
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro");

		put("/api/admin/tiers/pro", renamed("professional", "Professional", 999));

		assertThat(tierNamed("pro").get("tier").get("name").asString()).isEqualTo("Pro");
		assertThat(tierNamed("pro").get("relistQuotaPerPeriod").asInt()).isEqualTo(50);
	}

	/**
	 * A code another tier already holds is the second refusal, and nobody types one to reach it: renaming the
	 * free tier to "Pro" derives {@code pro}. Answered rather than left to the unique index, which would
	 * arrive under the route as a {@code 500}.
	 */
	@Test
	void norOntoACodeAnotherTierAlreadyHolds() {
		HttpResponse<String> refused = put("/api/admin/tiers/free", renamed("pro", "Pro", 3));

		assertThat(refused.statusCode()).isEqualTo(409);
		assertThat(refused.body()).isEmpty();
		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).containsExactly("free", "pro", "power");
	}

	/**
	 * Nor onto {@code order}, which is the one code this API could store and could never address again:
	 * {@code PUT /api/admin/tiers/order} is the reorder route, and Spring prefers the literal. Refused by the
	 * route rather than by the catalog, because a routing table is not something {@code TierEdits} knows
	 * about — and reachable at all only because a <em>name</em> now derives a code ("Order" does).
	 */
	@Test
	void norOntoTheOneCodeThisApiCouldNeverAddressAgain() {
		HttpResponse<String> refused = put("/api/admin/tiers/free", renamed("order", "Order", 3));

		assertThat(refused.statusCode()).isEqualTo(409);
		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).containsExactly("free", "pro", "power");
	}

	/** And a plan cannot be created under it either, which would be a Stripe Product for an unreachable row. */
	@Test
	void andNoPlanIsCreatedUnderItEither() {
		assertThat(post(PLANS, newPlan("order")).statusCode()).isEqualTo(409);

		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).containsExactly("free", "pro", "power");
	}

	/**
	 * Nor onto a code no path could carry back, which is the same trap one spelling over: a {@code /} is a
	 * segment Spring will not decode into a {@code @PathVariable} even encoded, so the row would be as lost
	 * as one filed under {@code order}. The form cannot reach this — {@code tierCodeFrom} answers either
	 * {@code [a-z0-9-]+} or nothing — so this is the backstop for a script.
	 */
	@Test
	void norOntoACodeNoPathCouldCarryBack() {
		assertThat(put("/api/admin/tiers/free", renamed("a/b", "A B", 3)).statusCode()).isEqualTo(409);
		assertThat(put("/api/admin/tiers/free", renamed("Gratis", "Gratis", 3)).statusCode()).isEqualTo(409);

		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).containsExactly("free", "pro", "power");
	}

	/**
	 * But a tier already filed under an odd code stays editable, which is why the shape is asked only of a
	 * <em>move</em>. A code arrives from {@code metadata.tier_code} as whatever somebody typed in Stripe, and
	 * a guard that refused to store it again would make that row the one nothing could ever fix.
	 */
	@Test
	void butATierAlreadyFiledUnderOneStaysEditable() {
		this.db.update("insert into tier (code, name, relist_quota_per_period, max_marktplaats_accounts) "
				+ "values ('Odd_Code', 'Odd', 5, 1)");

		assertThat(put("/api/admin/tiers/Odd_Code", edit("Odd_Code", 9, false)).statusCode()).isEqualTo(200);

		assertThat(this.db.queryForObject("select relist_quota_per_period from tier where code = 'Odd_Code'",
				Integer.class)).isEqualTo(9);
	}

	/** And a plan is not created under one either, for the reason it is not created under {@code order}. */
	@Test
	void andNoPlanIsCreatedUnderOneOfThoseEither() {
		assertThat(post(PLANS, newPlan("Not A Code")).statusCode()).isEqualTo(409);

		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).containsExactly("free", "pro", "power");
	}

	/**
	 * Naming the code it already has is not a move, so nothing about it is checked — which is what makes a
	 * form that sends every field safe to submit against a priced tier at all.
	 */
	@Test
	void andSendingBackTheCodeItAlreadyHasIsNotAMove() {
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro");

		assertThat(put("/api/admin/tiers/pro", edit("pro", 75, false)).statusCode()).isEqualTo(200);

		assertThat(tierNamed("pro").get("relistQuotaPerPeriod").asInt()).isEqualTo(75);
	}

	/**
	 * And leaving the code out is forgetting it rather than asking for the path's, which is the rule every
	 * other field on this body keeps: a {@code PUT} that guessed one would be storing something nobody stated.
	 */
	@Test
	void andLeavingTheCodeOutIsA400RatherThanTheOneInThePath() {
		HttpResponse<String> refused = put("/api/admin/tiers/pro",
				"{\"name\":\"Pro\",\"relistQuotaPerPeriod\":50,\"features\":{},\"published\":true}");

		assertThat(refused.statusCode()).isEqualTo(400);
		assertThat(tierNamed("pro").get("published").asBoolean()).isFalse();
	}

	/** As is a blank one, which is what a name with no letter or digit in it derives to. */
	@Test
	void andSoIsACodeThatIsBlank() {
		assertThat(put("/api/admin/tiers/pro", renamed("", "Pro", 50)).statusCode()).isEqualTo(400);

		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).containsExactly("free", "pro", "power");
	}

	/** Nor the Stripe Price, which nobody types anywhere: the tag on the Price is the only link (ADR-0019). */
	@Test
	void andNeverTheStripePrice() {
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro");

		put("/api/admin/tiers/pro", "{\"code\":\"pro\",\"name\":\"Pro\",\"relistQuotaPerPeriod\":50,\"features\":{},"
				+ "\"published\":false,\"prices\":[{\"stripePriceId\":\"price_somebody_typed\"}]}");

		assertThat(pricesOf("pro")).containsExactly("price_pro:month");
	}

	@Test
	void aTierNobodyStoredIsNotOneToEdit() {
		HttpResponse<String> refused = put("/api/admin/tiers/nonesuch", edit("nonesuch", 10, false));

		assertThat(refused.statusCode()).isEqualTo(404);
		assertThat(refused.body()).isEmpty();
	}

	// --- publishing -----------------------------------------------------------------------------------------

	@Test
	void aTierWithAPriceCanBePutOnSaleAndTakenBackOff() {
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro");

		assertThat(put("/api/admin/tiers/pro", edit("pro", 50, true)).statusCode()).isEqualTo(200);
		assertThat(tierNamed("pro").get("published").asBoolean()).isTrue();

		assertThat(put("/api/admin/tiers/pro", edit("pro", 50, false)).statusCode()).isEqualTo(200);
		assertThat(tierNamed("pro").get("published").asBoolean()).isFalse();
	}

	/**
	 * Publishing a tier with nothing to charge against is refused, and the refusal is the one thing this route
	 * conflicts over. Answered rather than thrown: {@code tier_is_published_only_with_a_price} would take the
	 * row anyway, as a `500` where what is wanted is an operator being told to go and create a Price.
	 */
	@Test
	void butATierWithNoPriceCannotBePutOnSaleAtAll() {
		HttpResponse<String> refused = put("/api/admin/tiers/pro", edit("pro", 50, true));

		assertThat(refused.statusCode()).isEqualTo(409);
		assertThat(refused.body()).isEmpty();
	}

	/** And nothing else in the row moved either — a refused edit is not a partial one. */
	@Test
	void andTheRefusedEditChangedNothing() {
		put("/api/admin/tiers/pro", "{\"code\":\"pro\",\"name\":\"Renamed\",\"relistQuotaPerPeriod\":999,\"features\":{},"
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
	 * Which is the whole design of it: there is no request on this route that <em>clears</em> the flag, so
	 * three of them in a row leave the catalog with exactly one default rather than with none.
	 *
	 * <p>The reason used to be sharper. A catalog with no default took down every new sign-in, because
	 * {@code TierCatalog.defaultTier()} threw and {@code ProvisionOnFirstLogin} caught nothing — and T77
	 * (ADR-0032) made both false on purpose, so that a deliberately emptied catalog is a state rather than an
	 * outage. The shape of this route survives its reason; what a catalog reaches no default <em>by</em> is a
	 * delete, which {@code TierDeletionTest} owns.
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
		assertThat(put("/api/admin/tiers/free", edit("free", 0, false)).statusCode()).isEqualTo(200);

		assertThat(tierNamed("free").get("relistQuotaPerPeriod").asInt()).isZero();
		assertThat(defaultTiers()).containsExactly("free");
	}

	// --- unlimited (T73, #160; ADR-0029) ------------------------------------------------------------------------

	/**
	 * The sentinel, end to end: an explicit JSON {@code null} on the write side comes back as a {@code null}
	 * on the read side and is stored as one in the column.
	 */
	@Test
	void aTierMayGrantUnlimitedReposts() {
		assertThat(put("/api/admin/tiers/pro", editUnlimited("pro", false)).statusCode()).isEqualTo(200);

		assertThat(tierNamed("pro").get("relistQuotaPerPeriod").isNull()).isTrue();
		assertThat(this.db.queryForObject("select relist_quota_per_period from tier where code = 'pro'",
				Integer.class)).isNull();
	}

	/**
	 * <strong>Absent and {@code null} are different on this one field, and only on this one.</strong>
	 * Everywhere else on this request {@code null} means <em>you forgot it</em>, and that rule is what
	 * ADR-0029 had to make a local exception to. Asserted as a pair, because the value of the distinction is
	 * entirely in the two answers differing — either alone would pass against a reader that could not tell
	 * them apart.
	 */
	@Test
	void andLeavingTheQuotaOutIsStillForgettingItRatherThanAskingForUnlimited() {
		assertThat(put("/api/admin/tiers/pro", "{\"code\":\"pro\",\"name\":\"Pro\",\"relistQuotaPerPeriod\":null,"
				+ "\"features\":{},\"published\":false}").statusCode()).isEqualTo(200);
		assertThat(put("/api/admin/tiers/pro", "{\"code\":\"pro\",\"name\":\"Pro\",\"features\":{},\"published\":false}")
				.statusCode()).isEqualTo(400);

		// The refused one changed nothing, so the tier is still the unlimited one the first call made.
		assertThat(tierNamed("pro").get("relistQuotaPerPeriod").isNull()).isTrue();
	}

	/** And a quota that is neither a whole number nor null is a body this API can read and cannot use. */
	@Test
	void andAQuotaThatIsNeitherANumberNorNullIsNotAnEdit() {
		assertThat(put("/api/admin/tiers/pro", "{\"code\":\"pro\",\"name\":\"Pro\",\"relistQuotaPerPeriod\":\"lots\","
				+ "\"features\":{},\"published\":false}").statusCode()).isEqualTo(400);
		assertThat(tierNamed("pro").get("relistQuotaPerPeriod").asInt()).isEqualTo(50);
	}

	/**
	 * A published tier grants something (ADR-0029) — the backstop under a form that warns and withdraws the
	 * tier itself. It closes a gap the {@code > 0} guard on the sync's auto-publish path left open: this row
	 * was hand-publishable, and a buyer could have paid for it.
	 */
	@Test
	void aTierGrantingNothingCannotBePutOnSale() {
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro");

		HttpResponse<String> refused = put("/api/admin/tiers/pro", edit("pro", 0, true));

		assertThat(refused.statusCode()).isEqualTo(409);
		assertThat(refused.body()).isEmpty();
		// And nothing about the row moved — not the quota it would have kept either.
		assertThat(tierNamed("pro").get("relistQuotaPerPeriod").asInt()).isEqualTo(50);
		assertThat(tierNamed("pro").get("published").asBoolean()).isFalse();
	}

	/** An unlimited one may, because it grants everything rather than nothing. */
	@Test
	void butAnUnlimitedOneCan() {
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro");

		assertThat(put("/api/admin/tiers/pro", editUnlimited("pro", true)).statusCode()).isEqualTo(200);

		assertThat(tierNamed("pro").get("published").asBoolean()).isTrue();
		assertThat(tierNamed("pro").get("relistQuotaPerPeriod").isNull()).isTrue();
	}

	/**
	 * And what its subscribers have left is no number at all rather than a large one — the read side of the
	 * same sentinel, on the body both clients render.
	 */
	@Test
	void andItsSubscribersHaveNoNumberLeftRatherThanALargeOne() {
		Subscriber user = this.rows.entitledTo(3);
		String code = (String) this.rows.tierOf(user).get("code");
		this.rows.unitHeldBy(user, Subscribers.now().minusMinutes(1));

		assertThat(put("/api/admin/tiers/" + code, editUnlimited(code, false)).statusCode()).isEqualTo(200);

		assertThat(displayStateOf(user).get("quotaRemaining").isNull()).isTrue();
		assertThat(displayStateOf(user).get("relistQuotaPerPeriod").isNull()).isTrue();
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

		assertThat(put("/api/admin/tiers/" + code, edit(code, 1, false)).statusCode()).isEqualTo(200);

		assertThat(quotaRemainingOf(user)).isZero();
	}

	/** And raising it is felt immediately, by the same arithmetic and with nothing written to their row. */
	@Test
	void andRaisingOneIsFeltWithoutTouchingAnybodysSubscription() {
		Subscriber user = this.rows.entitledTo(3);
		String code = (String) this.rows.tierOf(user).get("code");
		this.rows.unitHeldBy(user, Subscribers.now().minusMinutes(1));

		put("/api/admin/tiers/" + code, edit(code, 10, false));

		assertThat(quotaRemainingOf(user)).isEqualTo(9);
	}

	// --- the order the catalog is read in (T75, #164) ---------------------------------------------------------

	/**
	 * The order is stated rather than derived (ADR-0030), and the list is what states it.
	 *
	 * <p>The catalog was {@code free, pro, power} — {@code order by relist_quota_per_period, code}, which the
	 * seed's own 3/50/200 made indistinguishable from creation order for as long as nobody looked. Nothing
	 * about what these three tiers grant changes below; only where an operator wants them read.
	 */
	@Test
	void theCatalogIsHeldInTheOrderAnOperatorPutItIn() {
		assertThat(put(ORDER, order("power", "pro", "free")).statusCode()).isEqualTo(200);

		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).containsExactly("power", "pro", "free");
	}

	/** And the answer is the catalog as it now stands, so a screen has nothing to fetch to reconcile with. */
	@Test
	void andTheAnswerIsTheWholeCatalogInItsNewOrder() {
		HttpResponse<String> ordered = put(ORDER, order("power", "free", "pro"));

		assertThat(codesIn(Json.of(ordered).get("tiers"))).containsExactly("power", "free", "pro");
	}

	/**
	 * <strong>No {@code position} travels on the wire in either direction</strong> (ADR-0026): the array is
	 * already in order, and a number beside an ordered array is one fact spelled twice — two things that can
	 * disagree, on a screen whose whole job is to keep them agreeing.
	 */
	@Test
	void andNoTierEverCarriesTheNumberItIsHeldAt() {
		put(ORDER, order("power", "pro", "free"));

		for (JsonNode tier : Json.of(get(TIERS)).get("tiers")) {
			assertThat(tier.has("position")).isFalse();
		}
	}

	/**
	 * The free tier and every draft carry a place, which is why they are in the list an operator sends.
	 *
	 * <p>Ordering only the published rows was the alternative and is worse in a way that only shows later
	 * (ADR-0030): publishing is a checkbox on a form opened for other reasons, so a tier taken off sale for an
	 * afternoon would lose its place and come back somewhere new. A position that survives a publish toggle is
	 * one an operator can trust, and the cost is that moving {@code free} changes nothing a buyer sees.
	 */
	@Test
	void andEveryTierCarriesAPlaceIncludingTheOnesNobodyCanBuy() {
		put(ORDER, order("free", "power", "pro"));
		put("/api/admin/tiers/pro", edit("pro", 50, false));

		// Unpublishing Pro moved it nowhere: the order is the catalog's own and not a property of what is on
		// sale this afternoon.
		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).containsExactly("free", "power", "pro");
	}

	/**
	 * A list that is not exactly the catalog's set is one refusal said three ways, and the recovery is the
	 * same for all three: the screen is stale, reload it.
	 */
	@Test
	void aListThatIsNotTheCatalogIsNotAnOrder() {
		// A code nothing is stored under.
		assertThat(put(ORDER, order("free", "pro", "power", "nonesuch")).statusCode()).isEqualTo(409);
		// A tier the list forgot — which is what a draft the Stripe sync adopted while the page was open
		// looks like from here, and the reason this doubles as the concurrency check.
		assertThat(put(ORDER, order("free", "pro")).statusCode()).isEqualTo(409);
		// A code named twice, which is two answers to one question about where that tier goes.
		assertThat(put(ORDER, order("free", "pro", "pro")).statusCode()).isEqualTo(409);
	}

	@Test
	void andTheRefusalCarriesNothingToRead() {
		HttpResponse<String> refused = put(ORDER, order("free", "pro"));

		assertThat(refused.statusCode()).isEqualTo(409);
		assertThat(refused.body()).isEmpty();
	}

	@Test
	void andARefusedOrderMovedNothing() {
		put(ORDER, order("power", "pro", "free"));

		assertThat(put(ORDER, order("free", "pro")).statusCode()).isEqualTo(409);

		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).containsExactly("power", "pro", "free");
	}

	/**
	 * A tier nobody placed goes last — the row {@code price.created} drafts for an unknown {@code tier_code},
	 * which is a job to deal with rather than a plan to sell.
	 *
	 * <p>Written as a bare insert on purpose. The rule is {@code V10__catalog_order.sql}'s
	 * {@code tier_is_placed_last} rather than a line in {@code TierRows.adopt}, so it holds for the sync, for
	 * the seed and for a fixture like this one — and this test is what says so.
	 */
	@Test
	void aTierNobodyPlacedGoesLast() {
		put(ORDER, order("power", "pro", "free"));

		this.db.update("insert into tier (code, name, relist_quota_per_period, max_marktplaats_accounts) "
				+ "values ('starter', 'Starter', 0, 1)");

		assertThat(codesIn(Json.of(get(TIERS)).get("tiers")))
				.containsExactly("power", "pro", "free", "starter");
	}

	@Test
	void andABodyNamingNoOrderAtAllIsNotOne() {
		// Not an empty catalog: a body with no `codes` is one this API could read and could not use.
		assertThat(put(ORDER, "{}").statusCode()).isEqualTo(400);
		assertThat(put(ORDER, "not json").statusCode()).isEqualTo(400);
	}

	// --- bodies this API will not take -------------------------------------------------------------------------

	@Test
	void anEditThatLeavesOutAFieldItCouldChangeIsNotOne() {
		// Guessing either would change a plan nobody asked to change: a missing `published` would unpublish it
		// and a missing quota would strip it.
		assertThat(put("/api/admin/tiers/pro", "{\"code\":\"pro\",\"name\":\"Pro\",\"features\":{}}")
				.statusCode()).isEqualTo(400);
		assertThat(put("/api/admin/tiers/pro", "{\"code\":\"pro\",\"name\":\"Pro\",\"relistQuotaPerPeriod\":5}")
				.statusCode())
				.isEqualTo(400);
	}

	@Test
	void andNeitherIsATierCalledNothingOrOneGrantingLessThanNothing() {
		assertThat(put("/api/admin/tiers/pro", "{\"code\":\"pro\",\"name\":\"  \","
				+ "\"relistQuotaPerPeriod\":5,\"features\":{},\"published\":false}").statusCode())
				.isEqualTo(400);
		assertThat(put("/api/admin/tiers/pro", "{\"code\":\"pro\",\"name\":\"Pro\","
				+ "\"relistQuotaPerPeriod\":-1,\"features\":{},\"published\":false}").statusCode())
				.isEqualTo(400);
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
		assertThat(putAs("/api/admin/tiers/pro", edit("pro", 1, false), IDP.token()).statusCode())
				.isEqualTo(403);
		assertThat(putAs("/api/admin/tiers/pro/default", null, IDP.token()).statusCode()).isEqualTo(403);
		assertThat(putAs(ORDER, order("power", "pro", "free"), IDP.token()).statusCode()).isEqualTo(403);
		assertThat(getAs(PRICES, IDP.token()).statusCode()).isEqualTo(403);
	}

	@Test
	void andAnEditThatWasRefusedNeverRan() {
		putAs("/api/admin/tiers/pro", edit("pro", 999, false), IDP.token());

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
	/**
	 * A plan granting nothing and asking to be on sale is refused as a body rather than as a conflict, and
	 * <strong>before Stripe is touched</strong> (T73, ADR-0029). The edit route answers {@code 409} for the
	 * same mistake because nothing has happened yet when it decides; here a refusal at the end would arrive
	 * with a Stripe Product already created, as a {@code 409} an operator would read as "that code is taken"
	 * — and rename, retry, and make a second Product.
	 */
	@Test
	void andAPlanGrantingNothingIsNotOneToPutOnSale() {
		String onSale = "{\"tierCode\":\"starter\",\"name\":\"Starter\","
				+ "\"prices\":[{\"amount\":500,\"interval\":\"month\"}],"
				+ "\"relistQuotaPerPeriod\":0,\"features\":{},\"published\":true}";

		assertThat(post(PLANS, onSale).statusCode()).isEqualTo(400);
		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).doesNotContain("starter");
	}

	/** Unlimited is not that: it grants everything, so it gets as far as Stripe like any other plan. */
	@Test
	void butAnUnlimitedOneReachesStripeLikeAnyOther() {
		String unlimited = "{\"tierCode\":\"starter\",\"name\":\"Starter\","
				+ "\"prices\":[{\"amount\":500,\"interval\":\"month\"}],"
				+ "\"relistQuotaPerPeriod\":null,\"features\":{},\"published\":true}";

		// No Stripe key is configured in this suite, so "as far as Stripe" is where it stops — which is the
		// 422 every other well-formed plan gets here, and not the 400 above.
		assertThat(post(PLANS, unlimited).statusCode()).isEqualTo(422);
	}

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
		assertThat(post(PLANS, "{\"tierCode\":\"starter\",\"name\":\"Starter\","
				+ "\"relistQuotaPerPeriod\":10,\"published\":true}").statusCode())
				.isEqualTo(400);
		assertThat(post(PLANS, "{\"tierCode\":\"starter\",\"name\":\"Starter\","
				+ "\"prices\":[{\"amount\":500,\"interval\":\"month\"}],\"published\":true}").statusCode())
				.isEqualTo(400);
	}

	/**
	 * A plan states every rhythm it is sold at, and each of them fully (T66).
	 *
	 * <p>A rhythm named twice is two answers to one question rather than a plan sold two ways: adopted, the
	 * second would silently replace the first, so it is refused where it was typed.
	 *
	 * <p><strong>An empty list is no longer one of these</strong> (T79). It used to be "the same as no list —
	 * a plan nobody can be charged for", which is precisely what the free tier is, and since T77 made the
	 * seeded one deletable that had become the only spelling of a thing nothing else could make. Absent stays
	 * a {@code 400}, pinned by {@code andABodyThatLeavesOutWhatItCostsOrWhatItGrantsIsNotOne} above.
	 */
	@Test
	void andEachRhythmItIsSoldAtIsStatedInFull() {
		assertThat(post(PLANS, newPlan("starter", "[{\"interval\":\"month\"}]")).statusCode()).isEqualTo(400);
		assertThat(post(PLANS, newPlan("starter", "[{\"amount\":500}]")).statusCode()).isEqualTo(400);
		assertThat(post(PLANS, newPlan("starter", "[{\"amount\":500,\"interval\":\"month\"},"
				+ "{\"amount\":900,\"interval\":\"month\"}]")).statusCode()).isEqualTo(400);
	}

	/**
	 * And at most one tier has no price at all, which since T79 is a rule rather than a shape (ADR-0031).
	 *
	 * <p>A tier with no {@code tier_price} row <em>is</em> the free tier, and ADR-0031 rested "at most one" on
	 * every creation path going through Stripe — so a second was unsayable rather than forbidden. T77 made the
	 * seeded one deletable and nothing could then make another, so the emptiness had to become expressible and
	 * the count had to become checked. That trade is the whole cost of T79.
	 *
	 * <p>The seed ships {@code free} with no price, so this asks for a second and is refused. The creation
	 * itself is in {@code TierDeletionTest}, which is where a catalog without one can be arranged.
	 */
	@Test
	void andAtMostOneTierHasNoPriceAtAll() {
		assertThat(post(PLANS, newPlan("starter", "[]")).statusCode()).isEqualTo(409);
	}

	/**
	 * And at a rhythm Stripe actually bills by, refused before Stripe is asked for anything.
	 *
	 * <p><strong>Where this is said matters more than that it is said.</strong> The vocabulary check used to
	 * live where the Price is built, which threw an unchecked exception out of the middle of the creation —
	 * a {@code 500}, and since a plan may state several rhythms, a {@code 500} arriving <em>after</em> an
	 * earlier rhythm's Price had already been created and tagged. That leaves a real Price in Stripe which the
	 * {@code price.created} webhook then adopts into a draft tier, under a code the operator's retry is now
	 * refused for. Saying it on the way in makes it the {@code 400} the contract always promised.
	 */
	@Test
	void andAtARhythmStripeBillsBy() {
		assertThat(post(PLANS, newPlan("starter", "[{\"amount\":500,\"interval\":\"fortnight\"}]"))
				.statusCode()).isEqualTo(400);
		// The one that used to half-create: a good rhythm, then a bad one.
		assertThat(post(PLANS, newPlan("starter", "[{\"amount\":500,\"interval\":\"month\"},"
				+ "{\"amount\":5000,\"interval\":\"quarter\"}]")).statusCode()).isEqualTo(400);
		assertThat(post("/api/admin/tiers/pro/prices", "{\"amount\":900,\"interval\":\"quarter\"}")
				.statusCode()).isEqualTo(400);
	}

	@Test
	void andNeitherIsOneNamingNoTier() {
		assertThat(post(PLANS, newPlan("")).statusCode()).isEqualTo(400);
	}

	/**
	 * A currency cannot be named at all, which is how the catalog stays in one (T63, #129).
	 *
	 * <p>Every tier is priced in the Stripe account's own settlement currency. A plan screen is a comparison
	 * and €9,99 against $12.99 is not one a buyer can make — so the currency is not a choice per plan, and
	 * since it is not a choice it is not a field. A body carrying one is ignored rather than obeyed.
	 */
	@Test
	void andACurrencyCannotBeNamedAtAll() {
		HttpResponse<String> refused = post(PLANS, "{\"tierCode\":\"starter\",\"name\":\"Starter\","
				+ "\"currency\":\"usd\",\"prices\":[{\"amount\":500,\"interval\":\"month\"}],"
				+ "\"relistQuotaPerPeriod\":10,\"published\":false}");

		// With no Stripe configured the catalog's own currency cannot be read either, so this is the same
		// 422 every creation gets here — what matters is that the `usd` was not what decided it.
		assertThat(refused.statusCode()).isEqualTo(422);
		assertThat(Json.of(refused).get("problem").asString()).doesNotContain("usd");
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
	void andTheCurrencyToPriceItInIsUnknownRatherThanGuessedAt() {
		HttpResponse<String> unavailable = get(CURRENCY);

		assertThat(unavailable.statusCode()).isEqualTo(503);
		assertThat(unavailable.body()).isEmpty();
	}

	@Test
	void andNoneOfItIsReachableWithoutTheAdminRoleEither() {
		assertThat(postAs(PLANS, newPlan("starter"), IDP.token()).statusCode()).isEqualTo(403);
		assertThat(getAs(CURRENCY, IDP.token()).statusCode()).isEqualTo(403);
	}

	// --- a second rhythm for a plan that exists (T62, #128) -------------------------------------------------------

	/**
	 * With no Stripe configured a price cannot be created either, and the refusal carries Stripe's own words —
	 * the same shape as creating a plan, because in Stripe they are the same act.
	 */
	@Test
	void aRhythmCannotBeAddedWithoutAStripeToCreateItIn() {
		HttpResponse<String> refused = post("/api/admin/tiers/pro/prices",
				"{\"amount\":9900,\"interval\":\"year\"}");

		assertThat(refused.statusCode()).isEqualTo(422);
		assertThat(Json.of(refused).get("problem").asString()).contains("Stripe");
		assertThat(pricesOf("pro")).isEmpty();
	}

	@Test
	void andATierNobodyStoredHasNoRhythmToAddOneTo() {
		// A `404` even with no Stripe configured: what is wrong with the request is answered before what is
		// wrong with our ability to act on it, so the operator is told the code is unknown rather than that
		// Stripe is unreachable — and discovers the real problem on the retry.
		assertThat(post("/api/admin/tiers/nonesuch/prices", "{\"amount\":9900,\"interval\":\"year\"}")
				.statusCode()).isEqualTo(404);
	}

	@Test
	void andABodyThatNamesNoAmountOrNoRhythmIsNotOne() {
		assertThat(post("/api/admin/tiers/pro/prices", "{\"interval\":\"year\"}").statusCode())
				.isEqualTo(400);
		assertThat(post("/api/admin/tiers/pro/prices", "{\"amount\":9900}").statusCode()).isEqualTo(400);
	}

	/**
	 * A tier sold at two rhythms is one row with two prices — which is the whole of T62 (#128), seen from the
	 * screen an operator maintains it on.
	 */
	@Test
	void aTierSoldAtTwoRhythmsIsOneRowWithTwoPrices() {
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro");
		TierPrices.soldAt(this.db, "pro", "price_pro_yearly", "year");

		assertThat(codesIn(Json.of(get(TIERS)).get("tiers"))).containsExactly("free", "pro", "power");
		assertThat(pricesOf("pro")).containsExactly("price_pro:month", "price_pro_yearly:year");
		assertThat(tierNamed("pro").get("relistQuotaPerPeriod").asInt()).isEqualTo(50);
	}

	/** And it may be published on the strength of either, since both are something to charge against. */
	@Test
	void andItMayBePutOnSaleOnTheStrengthOfEither() {
		TierPrices.soldAt(this.db, "pro", "price_pro_yearly", "year");

		assertThat(put("/api/admin/tiers/pro", edit("pro", 50, true)).statusCode()).isEqualTo(200);
		assertThat(tierNamed("pro").get("published").asBoolean()).isTrue();
	}

	@Test
	void andNoneOfThatIsReachableWithoutTheAdminRole() {
		assertThat(postAs("/api/admin/tiers/pro/prices", "{\"amount\":9900,\"interval\":\"year\"}",
				IDP.token()).statusCode()).isEqualTo(403);
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

	/** What a tier is sold at, as `id:rhythm`, in the order the API answers with. */
	private List<String> pricesOf(String code) {
		return tierNamed(code).get("prices").valueStream()
				.map(price -> price.get("stripePriceId").asString() + ":" + price.get("interval").asString())
				.toList();
	}

	private static List<String> codesIn(JsonNode tiers) {
		return tiers.valueStream().map(tier -> tier.get("tier").get("code").asString()).toList();
	}

	private List<String> defaultTiers() {
		return this.db.queryForList("select code from tier where is_default", String.class);
	}

	private int quotaRemainingOf(Subscriber user) {
		return displayStateOf(user).get("quotaRemaining").asInt();
	}

	/** {@code GET /api/me} as this subscriber — the body an edit is felt on, without a second call's shape. */
	private JsonNode displayStateOf(Subscriber user) {
		return Json.of(Http.send(HttpRequest.newBuilder(uri("/api/me"))
				.timeout(TIMEOUT)
				.header("Authorization", "Bearer " + user.token())
				.GET()
				.build()));
	}

	/**
	 * No currency: the catalog has one, read from Stripe, and no request may name another (T63, #129).
	 *
	 * <p>Sold both ways, which is what T66 made a plan able to say in one submit — an operator states the
	 * monthly and the annual amount on the form that creates it rather than adding the second afterwards.
	 */
	private static String newPlan(String code) {
		return newPlan(code, "[{\"amount\":500,\"interval\":\"month\"},"
				+ "{\"amount\":5000,\"interval\":\"year\"}]");
	}

	private static String newPlan(String code, String prices) {
		return "{\"tierCode\":\"" + code + "\",\"name\":\"Starter\",\"prices\":" + prices
				+ ",\"relistQuotaPerPeriod\":10,\"features\":{},\"published\":false}";
	}

	/** The whole catalog, in order, as the table sends it when a row is dropped somewhere new. */
	private static String order(String... codes) {
		return "{\"codes\":[\"" + String.join("\",\"", codes) + "\"]}";
	}

	/**
	 * An edit that leaves the tier filed where it is, which is what every edit but one is (T76, ADR-0031).
	 *
	 * <p>The code is stated rather than left out: the {@code PUT} is whole, so "not moving it" is said by
	 * sending back the code the path already names. A body without one is a {@code 400}, pinned below.
	 */
	private static String edit(String code, int quota, boolean published) {
		return "{\"code\":\"" + code + "\",\"name\":\"Pro\",\"relistQuotaPerPeriod\":" + quota
				+ ",\"features\":{},\"published\":" + published + "}";
	}

	/** The same body with the quota written out as an explicit JSON {@code null} — unlimited (ADR-0029). */
	private static String editUnlimited(String code, boolean published) {
		return "{\"code\":\"" + code + "\",\"name\":\"Pro\",\"relistQuotaPerPeriod\":null,"
				+ "\"features\":{},\"published\":" + published + "}";
	}

	/** An edit that files the tier under a different code — the free tier's rename, and nothing else. */
	private static String renamed(String to, String name, int quota) {
		return "{\"code\":\"" + to + "\",\"name\":\"" + name + "\",\"relistQuotaPerPeriod\":" + quota
				+ ",\"features\":{},\"published\":false}";
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

	/**
	 * The seed's three rows, by the code it filed them under — read once and then used to put them back.
	 *
	 * <p>Static because it outlives one test and one instance, and empty until the first fixture run: a
	 * Testcontainers Postgres is fresh per JVM, and nothing in this application renames a tier except the
	 * route this suite is about.
	 */
	private static final Map<String, UUID> SEEDED = new LinkedHashMap<>();

	private static final String TIERS = "/api/admin/tiers";

	private static final String ORDER = "/api/admin/tiers/order";

	private static final String PRICES = "/api/admin/prices";

	private static final String PLANS = "/api/admin/plans";

	private static final String CURRENCY = "/api/admin/currency";

	private static final Duration TIMEOUT = Duration.ofSeconds(20);

}
