package com.mprelist;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.mprelist.Subscribers.Subscriber;
import com.mprelist.catalog.Adoption;
import com.mprelist.catalog.PriceAdoptions;
import com.mprelist.catalog.TaggedPrice;

import tools.jackson.databind.JsonNode;

/**
 * {@code DELETE /api/admin/tiers/{code}}, and everything that follows from a tier no longer existing (T77,
 * <a href="../../../../docs/adr/0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md">ADR-0032</a>).
 *
 * <p><strong>Its own suite rather than a section of {@link AdminTierTest}</strong>, because most of what is
 * asserted here is not about the route. A delete is one transaction across two modules' tables and a queue,
 * and the interesting claims are the ones that span them: who the subscribers are afterwards, what the
 * catalog answers a subscriber who is on nothing, what Stripe is owed, and what the sync does with a code
 * whose Prices are still tagged. A test of the {@code 200} would be four lines.
 *
 * <p><strong>Over a real port and against a real Postgres</strong>, like its neighbours, and for a reason of
 * its own: {@code on delete set null} and the {@code tier_price} cascade are the schema doing half the work,
 * and a stand-in for the database would be a stand-in for the half being claimed.
 *
 * <p><strong>The tear-down job is switched off</strong>, and that is the arrangement rather than an omission.
 * What this suite asserts about Stripe is what the delete <em>enqueued</em> — the ids captured while they
 * still existed, which is the decision ADR-0032 argues at length — and a job draining the queue in the
 * background would be a second writer racing every assertion. What the job does with a row is
 * {@code StripeTearDownTest}, against a Stripe on a loopback port.
 *
 * <p>The reconciliation is off for {@link AdminTierTest}'s reason, and no Stripe key is configured, so
 * nothing here can reach the real thing even by accident.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "mprelist.stripe.secret-key=", "mprelist.reconciliation.interval=24h",
				"mprelist.stripe.teardown.interval=24h" })
@Import(PostgresFromCompose.class)
class TierDeletionTest {

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
	 * A catalog of this suite's own, and nothing else.
	 *
	 * <p><strong>The seeded three are deleted rather than restored</strong>, which is the opposite of what
	 * {@link AdminTierTest} does and is the only arrangement this suite can make: half of what it asserts is
	 * about the <em>last</em> tier and about a catalog with none, and neither is a state reachable while three
	 * rows somebody else's suite owns are sitting in the table. The rows are put back by nothing, because
	 * every suite that needs them arranges its own — {@code TierCatalogSeedTest} runs against a fresh
	 * container and is the one that reads the seed.
	 */
	@BeforeEach
	void aCatalogOfThisSuitesOwn() {
		this.rows = new Subscribers(this.db, IDP, "delete-suite-");
		this.rows.nobodyHasRelistedYet();
		this.db.update("delete from stripe_cleanup");
		this.db.update("update subscription set tier_id = null");
		this.db.update("delete from tier");
	}

	// --- the route ------------------------------------------------------------------------------------------

	/**
	 * The row goes, and the answer is the catalog that is left — not the row that went, and not an empty body.
	 *
	 * <p>The whole catalog for {@code PUT …/order}'s reason and one of its own: a delete removes a row, can
	 * move the default badge to nowhere at all, and can empty the list. A screen that removed one row and
	 * hoped would be a screen holding a default flag that no longer exists.
	 */
	@Test
	void deletingATierAnswersWithTheCatalogThatIsLeft() {
		tier("keep", "Keep", 10);
		tier("drop", "Drop", 20);

		HttpResponse<String> deleted = delete("drop");

		assertThat(deleted.statusCode()).isEqualTo(200);
		assertThat(codesIn(Json.of(deleted).get("tiers"))).containsExactly("keep");
		assertThat(codesStored()).containsExactly("keep");
	}

	/**
	 * A code nothing is stored under is the only refusal, and the claim is the sentence rather than the
	 * status: <strong>there is no state of the catalog this route declines to produce.</strong>
	 */
	@Test
	void andACodeNothingIsStoredUnderIsTheOnlyRefusal() {
		tier("keep", "Keep", 10);

		assertThat(delete("nothing-is-filed-here").statusCode()).isEqualTo(404);
		assertThat(codesStored()).containsExactly("keep");
	}

	/**
	 * Including the default tier, which is the one the narrower designs would have refused.
	 *
	 * <p>"Move the flag first, then delete" was the cheapest coherent alternative and is rejected in the ADR:
	 * it leaves one row permanently special for a reason that is internal — a foreign key and a throwing
	 * lookup — rather than one an operator would recognise.
	 */
	@Test
	void theDefaultTierIsDeletableLikeAnyOther() {
		tier("free", "Free", 3);
		tier("pro", "Pro", 50);
		makeDefault("free");

		assertThat(delete("free").statusCode()).isEqualTo(200);
		assertThat(codesStored()).containsExactly("pro");
		// And the catalog is left with no default at all, which is a state: `pro` is not promoted, because
		// promoting it would be this API choosing a plan for an operator.
		assertThat(theDefaultTier()).isNull();
	}

	/** And the last tier there is, which leaves the catalog empty — the state the whole ADR is about. */
	@Test
	void andSoIsTheLastTierThereIs() {
		tier("only", "The only plan", 5);
		makeDefault("only");

		HttpResponse<String> deleted = delete("only");

		assertThat(deleted.statusCode()).isEqualTo(200);
		assertThat(codesIn(Json.of(deleted).get("tiers"))).isEmpty();
		assertThat(codesStored()).isEmpty();
	}

	/**
	 * A tier coded {@code order} is deletable although it is not editable (T76, ADR-0031).
	 *
	 * <p>{@code PUT /api/admin/tiers/order} is mapped on the literal and wins the route over {@code {code}};
	 * a {@code DELETE} collides with nothing. So the one row this API can never address again can at least be
	 * removed — which is what an operator who hand-tagged a Stripe Price {@code order} is left needing.
	 */
	@Test
	void andATierFiledUnderTheReservedCodeCanAtLeastBeRemoved() {
		tier("order", "Order", 10);

		assertThat(delete("order").statusCode()).isEqualTo(200);
		assertThat(codesStored()).isEmpty();
	}

	// --- the people on it -----------------------------------------------------------------------------------

	/**
	 * Subscribers land on the default tier, in the delete's own transaction.
	 *
	 * <p>Asserted through {@code /api/me} rather than against the column, because what this is a claim about
	 * is what the user is <em>shown</em>: the plan they are on changes under them and everything else about
	 * their row — their window, their billing history — does not.
	 */
	@Test
	void everybodyOnADeletedTierLandsOnTheDefaultOne() {
		tier("free", "Free", 3);
		makeDefault("free");
		Subscriber user = aSubscriberOn("pro", 50);

		assertThat(delete("pro").statusCode()).isEqualTo(200);

		JsonNode shown = Json.of(displayStateOf(user));
		assertThat(shown.get("tier").get("code").asString()).isEqualTo("free");
		assertThat(shown.get("relistQuotaPerPeriod").asInt()).isEqualTo(3);
	}

	/**
	 * And where the tier being deleted <em>is</em> the default, they land on nothing and are denied
	 * {@code NO_TIER}.
	 *
	 * <p>This is the whole of what "an empty catalog is a state and not corruption" costs, and it is the state
	 * the code was added to describe. The subscription row survives — see the test below — so what has
	 * happened to this user is that their plan was deleted, not that their account was.
	 */
	@Test
	void andWhereThereIsNoDefaultToMoveThemToTheyAreOnNoTierAndSaidSo() {
		Subscriber user = aSubscriberOn("only", 5);
		makeDefault("only");

		assertThat(delete("only").statusCode()).isEqualTo(200);

		HttpResponse<String> refused = displayStateOf(user);
		assertThat(refused.statusCode()).isEqualTo(403);
		assertThat(Json.of(refused).get("reason").asString()).isEqualTo("NO_TIER");
	}

	/**
	 * The row survives the tier, and the two columns it survives <em>for</em> are the point (ADR-0018).
	 *
	 * <p>Deleting the subscription was the more literal reading of "they have no subscription" and is rejected
	 * on exactly this: {@code stripe_customer_id} is what makes resubscribing the same customer buying again
	 * rather than a stranger with the same email, and {@code created_at} is the anchor every later
	 * {@code resetAt} is rolled from — so a re-insert would move that user's reset date to the day an operator
	 * tidied the catalog.
	 */
	@Test
	void andTheirRowSurvivesWithTheirBillingHistoryAndTheirWindowAnchor() {
		Subscriber user = aSubscriberOn("only", 5);
		this.rows.billedAsStripeCustomer(user, "cus_kept");
		makeDefault("only");
		Map<String, Object> before = subscriptionOf(user);

		delete("only");

		Map<String, Object> after = subscriptionOf(user);
		assertThat(after.get("tier_id")).isNull();
		assertThat(after.get("stripe_customer_id")).isEqualTo("cus_kept");
		assertThat(after.get("created_at")).isEqualTo(before.get("created_at"));
		assertThat(after.get("id")).isEqualTo(before.get("id"));
	}

	/**
	 * And making a tier the default adopts every one of them, at once and in that route's own transaction.
	 *
	 * <p><strong>Precise rather than merely convenient:</strong> a subscription is tier-less only because no
	 * default existed, and this route is the sole writer of the flag, so it is the only moment that stops
	 * being true. Healing lazily on the read path was the alternative and heals one user at a time, only when
	 * they show up — which leaves a catalog that looks repaired and a population that is not. The user here
	 * never asks for anything between the delete and the heal.
	 */
	@Test
	void andMakingATierTheDefaultAdoptsEveryOrphanAtOnce() {
		Subscriber user = aSubscriberOn("only", 5);
		makeDefault("only");
		delete("only");
		tier("rescue", "Rescue", 7);

		assertThat(makeDefault("rescue").statusCode()).isEqualTo(200);

		JsonNode shown = Json.of(displayStateOf(user));
		assertThat(shown.get("tier").get("code").asString()).isEqualTo("rescue");
		assertThat(shown.get("quotaRemaining").asInt()).isEqualTo(7);
	}

	/**
	 * And a brand-new account signing in to an emptied catalog is provisioned rather than refused.
	 *
	 * <p>{@code ProvisionOnFirstLogin} used to throw here, which was right while an empty catalog could only
	 * be corruption. Now it writes a tier-less row: refusing to create accounts would turn one deleted tier
	 * into a sign-in outage nothing on an operator's screen explains, and the account this creates is healed
	 * by the same {@code PUT …/default} as everybody else.
	 */
	@Test
	void andSomebodySigningInToAnEmptiedCatalogIsProvisionedOntoNothingRatherThanRefused() {
		tier("only", "The only plan", 5);
		makeDefault("only");
		delete("only");

		String newcomer = UUID.randomUUID().toString();
		HttpResponse<String> first = displayStateOf(IDP.token(claims -> claims.subject(newcomer)));

		assertThat(first.statusCode()).isEqualTo(403);
		assertThat(Json.of(first).get("reason").asString()).isEqualTo("NO_TIER");
		assertThat(this.db.queryForObject("""
				select count(*) from subscription
				 join app_user on app_user.id = subscription.app_user_id
				 where app_user.idp_subject = ?
				""", Integer.class, newcomer)).isEqualTo(1);
	}

	// --- what Stripe is owed --------------------------------------------------------------------------------

	/**
	 * The Stripe work is captured in the delete's transaction, from ids that are about to stop existing.
	 *
	 * <p>One row per Stripe object rather than one per deleted tier, so that a subscription Stripe refuses for
	 * ever does not block the Price archiving behind it. Re-deriving it afterwards is impossible and that is
	 * the argument: {@code tier_price} has cascaded, the Product id was never stored, and the ex-subscribers'
	 * {@code tier_id} is null and indistinguishable from any other deletion's orphans.
	 */
	@Test
	void aDeleteCapturesEveryStripeCallItLeavesOutstanding() {
		Subscriber payer = aSubscriberOn("pro", 50);
		this.rows.mirroredFromStripe(payer);
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro_month");
		TierPrices.soldAt(this.db, "pro", "price_pro_year", "year");

		delete("pro");

		assertThat(outstanding()).containsExactlyInAnyOrder(
				Map.entry("cancel_subscription", stripeSubscriptionOf(payer)),
				Map.entry("archive_price", "price_pro_month"),
				Map.entry("archive_price", "price_pro_year"));
	}

	/**
	 * And the {@code tier_price} rows go with the tier, which is V7's cascade rather than anything this route
	 * does — the reason the ids have to be copied before the delete rather than read after it.
	 */
	@Test
	void andTheTierPriceRowsCascadeWithTheRow() {
		tier("pro", "Pro", 50);
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro_month");

		delete("pro");

		assertThat(this.db.queryForObject("select count(*) from tier_price", Integer.class)).isZero();
	}

	/**
	 * And a tier that is <strong>on sale</strong> deletes like any other, although V7's trigger watches
	 * exactly the rows the cascade takes.
	 *
	 * <p>{@code tier_price_is_not_the_last_of_a_published_tier} fires {@code after delete on tier_price} and
	 * refuses a published tier with nothing to charge against. It does not fire here, and the reason is
	 * timing rather than luck: it is a constraint trigger checked at the end of the <em>statement</em>, and by
	 * then there is no published tier without a price because there is no tier. Asserted rather than reasoned
	 * about, because the failure mode is a {@code 500} from a route an operator is standing in front of.
	 */
	@Test
	void andATierThatIsOnSaleDeletesDespiteTheTriggerWatchingItsPrices() {
		tier("pro", "Pro", 50);
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro_month");
		this.db.update("update tier set published = true where code = 'pro'");

		assertThat(delete("pro").statusCode()).isEqualTo(200);
		assertThat(codesStored()).isEmpty();
	}

	/**
	 * A tier nobody is paying for owes Stripe no cancellations — which is every free tier and every draft, and
	 * is the case the confirmation in {@code /admin} lets through in one click.
	 */
	@Test
	void andATierNobodyPaysForOwesNoCancellations() {
		aSubscriberOn("free", 3);

		delete("free");

		assertThat(outstanding()).isEmpty();
	}

	/**
	 * While anything is outstanding for a code, the sync refuses to draft it — which is the window a delete
	 * opens and the whole reason the queue is the catalog's own table.
	 *
	 * <p>The row goes at once while its Prices are still alive in Stripe and still tagged, and
	 * {@code isAboutAPrice()} is true for {@code price.updated} as well as {@code price.created} — so without
	 * this, an operator editing an archived Price, or Stripe emitting an update of its own, brings the deleted
	 * tier back at quota 0, filed last, as a log line nobody reads.
	 */
	@Test
	void andWhileThatWorkIsOutstandingTheSyncWillNotDraftTheCodeAgain() {
		tier("pro", "Pro", 50);
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro_month");
		delete("pro");

		Adoption adopted = this.sync.adopt(new TaggedPrice("pro", "price_pro_month", "month", "Pro"));

		assertThat(adopted).isEqualTo(Adoption.REFUSED_A_CODE_BEING_TORN_DOWN);
		assertThat(codesStored()).isEmpty();
	}

	/**
	 * And the code frees the moment the last of that work is done — a tombstone scoped to the window rather
	 * than to the code, which was the whole objection to a table of dead codes the sync declines for ever.
	 */
	@Test
	void andItFreesAgainOnceTheLastOfItIsDone() {
		tier("pro", "Pro", 50);
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro_month");
		delete("pro");
		this.db.update("update stripe_cleanup set done_at = now() where tier_code = 'pro'");

		assertThat(this.sync.adopt(new TaggedPrice("pro", "price_pro_month", "month", "Pro")))
				.isEqualTo(Adoption.DRAFTED_A_TIER);
	}

	/**
	 * And <strong>creating</strong> a plan under that code is refused before Stripe is touched.
	 *
	 * <p>The 409 above it checks the codes the catalog <em>holds</em>, and a deleted tier holds nothing — so
	 * without this the create sails past, makes a Stripe Product and a tagged Price per rhythm, and then meets
	 * the very refusal this ticket added on the {@code adopt} behind them. What the operator would get is a
	 * {@code 500} and Stripe objects no cleanup row covers, under a code they still cannot use.
	 *
	 * <p>Asserted by what Stripe was <em>not</em> asked for as much as by the status: with no API key
	 * configured a create that reached Stripe would answer {@code 422} carrying its own sentence, so a
	 * {@code 409} here is proof the refusal happened first.
	 */
	@Test
	void andCreatingAPlanUnderACodeStillBeingTornDownIsRefusedBeforeStripeIsTouched() {
		tier("pro", "Pro", 50);
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro_month");
		delete("pro");

		HttpResponse<String> refused = post(PLANS, newPlan("pro"));

		assertThat(refused.statusCode()).isEqualTo(409);
		assertThat(refused.body()).doesNotContain("problem");
	}

	/** And it is allowed again once the tear-down is done, like the sync. */
	@Test
	void andAllowedAgainOnceThatWorkIsDone() {
		tier("pro", "Pro", 50);
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro_month");
		delete("pro");
		this.db.update("update stripe_cleanup set done_at = now() where tier_code = 'pro'");

		// 422 rather than 201: no Stripe key is configured in this suite, so the create gets as far as asking
		// Stripe and is told there is no account to ask. Which is the assertion — it got past the refusal.
		assertThat(post(PLANS, newPlan("pro")).statusCode()).isEqualTo(422);
	}

	// --- what the screen is told ----------------------------------------------------------------------------

	/**
	 * Every row carries the two counts a confirmation is quantified from: how many move, and how many live
	 * Stripe subscriptions get cancelled.
	 *
	 * <p>The second is what {@code /admin} escalates on — typing the tier's name — so the two being different
	 * numbers is the claim rather than either one of them. A free tier with twelve people on it and nobody
	 * paying is deleted in one click; a paid tier with one payer is not.
	 */
	@Test
	void everyRowSaysHowManyPeopleAreOnItAndHowManyOfThemArePaying() {
		Subscriber payer = aSubscriberOn("pro", 50);
		this.rows.mirroredFromStripe(payer);
		aSubscriberOn("pro", 50);

		JsonNode pro = tierIn(Json.of(get(TIERS)).get("tiers"), "pro");

		assertThat(pro.get("subscribers").asInt()).isEqualTo(2);
		assertThat(pro.get("payingSubscribers").asInt()).isEqualTo(1);
	}

	/** And a tier nobody is on says zero rather than leaving the fields out. */
	@Test
	void andATierNobodyIsOnSaysZeroRatherThanNothing() {
		tier("draft", "A draft", 0);

		JsonNode draft = tierIn(Json.of(get(TIERS)).get("tiers"), "draft");

		assertThat(draft.get("subscribers").asInt()).isZero();
		assertThat(draft.get("payingSubscribers").asInt()).isZero();
	}

	// --- arranging ------------------------------------------------------------------------------------------

	/** A tier of this suite's own, filed under the code the tests name it by. */
	private void tier(String code, String name, int quota) {
		this.db.update("""
				insert into tier (code, name, relist_quota_per_period, max_marktplaats_accounts)
				values (?, ?, ?, 1)
				""", code, name, quota);
	}

	/**
	 * An account on a tier this suite names, rather than on the randomly-coded one
	 * {@link Subscribers#entitledTo} makes: every test here talks about a tier by its code, and two
	 * subscribers "on pro" have to be on one row rather than on two that happen to grant the same number.
	 *
	 * <p>The shared arrangement is still what creates the account and its subscription — that SQL is
	 * {@link Subscribers}' for the reason its own documentation gives — and the tier it brings with it is
	 * repointed and dropped.
	 */
	private Subscriber aSubscriberOn(String code, int quota) {
		if (!codesStored().contains(code)) {
			tier(code, code, quota);
		}
		Subscriber user = this.rows.entitledTo(quota);
		this.db.update("update subscription set tier_id = (select id from tier where code = ?) "
				+ "where app_user_id = ?", code, user.account());
		this.db.update("delete from tier where code like 'delete-suite-%'");
		return user;
	}

	private HttpResponse<String> makeDefault(String code) {
		return put(TIERS + "/" + code + "/default");
	}

	// --- reading back ---------------------------------------------------------------------------------------

	private List<String> codesStored() {
		return this.db.queryForList("select code from tier order by position, code", String.class);
	}

	private String theDefaultTier() {
		List<String> flagged = this.db.queryForList("select code from tier where is_default", String.class);
		return flagged.isEmpty() ? null : flagged.get(0);
	}

	/** The outstanding queue, as the pairs a reader can check: which call, about which Stripe object. */
	private List<Map.Entry<String, String>> outstanding() {
		return this.db.query("select kind, stripe_id from stripe_cleanup where done_at is null",
				(row, number) -> Map.entry(row.getString("kind"), row.getString("stripe_id")));
	}

	private Map<String, Object> subscriptionOf(Subscriber user) {
		return this.db.queryForMap("""
				select id, tier_id, stripe_customer_id, created_at
				  from subscription where app_user_id = ?
				""", user.account());
	}

	private String stripeSubscriptionOf(Subscriber user) {
		return this.db.queryForObject("select stripe_subscription_id from subscription where app_user_id = ?",
				String.class, user.account());
	}

	private static List<String> codesIn(JsonNode tiers) {
		return tiers.valueStream().map(tier -> tier.get("tier").get("code").asString()).toList();
	}

	private static JsonNode tierIn(JsonNode tiers, String code) {
		return tiers.valueStream()
				.filter(tier -> code.equals(tier.get("tier").get("code").asString()))
				.findFirst()
				.orElseThrow(() -> new IllegalStateException("No tier `" + code + "` in " + tiers));
	}

	// --- the calls ------------------------------------------------------------------------------------------

	private HttpResponse<String> get(String path) {
		return Http.send(request(path).header("Authorization", "Bearer " + operator()).GET().build());
	}

	private HttpResponse<String> put(String path) {
		return Http.send(request(path).header("Authorization", "Bearer " + operator())
				.PUT(HttpRequest.BodyPublishers.noBody())
				.build());
	}

	private HttpResponse<String> post(String path, String body) {
		return Http.send(request(path).header("Authorization", "Bearer " + operator())
				.header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(body, UTF_8))
				.build());
	}

	/** What the New plan form sends: a code, a name, one rhythm, and what the tier grants. */
	private static String newPlan(String code) {
		return "{\"tierCode\":\"" + code + "\",\"name\":\"" + code + "\","
				+ "\"prices\":[{\"amount\":500,\"interval\":\"month\"}],"
				+ "\"relistQuotaPerPeriod\":10,\"features\":{},\"published\":false}";
	}

	private HttpResponse<String> delete(String code) {
		return Http.send(request(TIERS + "/" + code).header("Authorization", "Bearer " + operator())
				.DELETE()
				.build());
	}

	private HttpResponse<String> displayStateOf(Subscriber user) {
		return displayStateOf(user.token());
	}

	private HttpResponse<String> displayStateOf(String token) {
		return Http.send(request("/api/me").header("Authorization", "Bearer " + token).GET().build());
	}

	private HttpRequest.Builder request(String path) {
		return HttpRequest.newBuilder(URI.create("http://localhost:" + this.port + path))
				.timeout(Duration.ofSeconds(20));
	}

	private String operator() {
		return IDP.token(claims -> claims.claim("realm_access", Map.of("roles", List.of("ADMIN"))));
	}

	@LocalServerPort
	private int port;

	@Autowired
	private JdbcTemplate db;

	/**
	 * The webhook's own call, reached directly. What the two tests about the resurrection window are claims
	 * about is {@code adopt}, and posting a signed Stripe event to get to it would make each of them also a
	 * test of the signature check — which is {@code StripePriceSyncTest}'s.
	 */
	@Autowired
	private PriceAdoptions sync;

	private Subscribers rows;

	private static final String TIERS = "/api/admin/tiers";

	private static final String PLANS = "/api/admin/plans";

}
