package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
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

import tools.jackson.databind.JsonNode;

/**
 * {@code GET /api/me}: what a signed-in caller is shown, and the fact that being shown it is not being
 * allowed anything (#26, ADR-0007, {@code docs/enforcement-contract.md}).
 *
 * <p>The first route outside {@code enforcement}, and the first one that composes four modules' answers —
 * the status and window from {@code subscription}, the tier's name and flags from {@code catalog}, and
 * {@code quotaRemaining} from the {@code usage_reservation} rows {@code enforcement} owns. So the assertions
 * below are as much about the four agreeing as about any one of them: the number rendered here is asserted to
 * be the number the gate refuses on, against a quota spent through the gate itself.
 *
 * <p>Over a real port for {@link ResourceServerTest}'s reason — this route is closed by a filter chain
 * MockMvc installs only when {@code spring-security-test} is on the classpath, and one test below is about
 * exactly that. State is arranged as data, which is the only way to reach a lapsed payer or a window that
 * closed three months ago.
 *
 * <p>Not {@code @Transactional}: the application answers on its own connection, so a rollback here would
 * neither see nor undo what it wrote. Each test empties {@code app_user} instead and drops the tiers this
 * suite arranged, leaving the seeded catalog — which {@code TierCatalogSeedTest} owns — as it found it.
 *
 * <p><strong>#24's reconciliation is switched off and #25's rails with it</strong>, for the reasons
 * {@link RelistAuthorizationTest} gives: two tests below arrange units held in a window that has since
 * closed, which are exactly the rows a reconciliation hands back, and one spends a quota one relist at a time
 * through {@code /authorize}, where the shipped 30-second interval would refuse the second call. Neither
 * setting is this endpoint's — nothing here is paced, because nothing here is a relist.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "mprelist.reconciliation.interval=24h", "mprelist.safety.minimum-interval=0s",
				"mprelist.safety.burst-window=0s" })
@Import(PostgresFromCompose.class)
class DisplayStateTest {

	/** In a field initialiser for {@link DynamicPropertySource}'s sake — see {@link ResourceServerTest}. */
	private static final MintedTokens IDP = MintedTokens.servingItsKeys();

	@DynamicPropertySource
	static void trustTheTokensThisSuiteMints(DynamicPropertyRegistry properties) {
		IDP.trustedAsTheIssuer(properties);
	}

	@AfterAll
	static void stopServingKeys() {
		IDP.close();
	}

	@BeforeEach
	void nobodyHasSignedInYet() {
		this.rows = new Subscribers(this.db, IDP, "display-suite-");
		this.calls = new Relists(this.port);
		this.rows.nobodyHasRelistedYet();
	}

	/**
	 * The five fields the contract names, in one body, for the ordinary subscriber: what plan they are on,
	 * whether it is live, what is left of it and when that comes back.
	 *
	 * <p>Asserted as the whole shape rather than field by field, because the shape is what a client is written
	 * against — a field quietly dropped is the failure this catches, and the tests after it are about the
	 * values in each.
	 */
	@Test
	void aSubscriberIsShownTheStatusTierQuotaAndResetDateOfThePlanTheyAreOn() {
		Subscriber user = aSubscriberEntitledTo(3);

		HttpResponse<String> shown = displayStateOf(user);

		assertThat(shown.statusCode()).isEqualTo(200);
		JsonNode state = Json.of(shown);
		assertThat(state.propertyNames()).containsExactlyInAnyOrder("subscriptionStatus", "tier", "quotaRemaining",
				"relistQuotaPerPeriod", "resetAt", "features");
		assertThat(state.get("subscriptionStatus").asString()).isEqualTo("ACTIVE");
		assertThat(state.get("quotaRemaining").asInt()).isEqualTo(3);
		assertThat(resetAtIn(state)).isEqualTo(this.rows.windowOf(user).end());
	}

	/**
	 * Both halves of "2 of 3", which is the sentence the popup draws (#41).
	 *
	 * <p>The pair is the point: the first number is what this period has left and moves with every relist, and
	 * the second is what the tier grants and does not. A client given only the first is a client that keeps a
	 * catalog of quotas ours never reaches — the same mistake {@link com.mprelist.catalog.TierName} exists to
	 * prevent for what a tier is called.
	 */
	@Test
	void andWhatTheTierGrantsBesideWhatIsLeftOfIt() {
		Subscriber user = aSubscriberEntitledTo(3);
		assertThat(relist(user, "ad-1").statusCode()).isEqualTo(200);

		JsonNode state = Json.of(displayStateOf(user));

		assertThat(state.get("quotaRemaining").asInt()).isEqualTo(2);
		assertThat(state.get("relistQuotaPerPeriod").asInt()).isEqualTo(3);
	}

	/**
	 * And the grant does not move when a unit is spent — asserted beside the number that does, because a pair
	 * where both halves fall is "2 of 2" on every screen and says nothing at all.
	 */
	@Test
	void andThatGrantDoesNotMoveWhenAUnitIsSpent() {
		Subscriber user = aSubscriberEntitledTo(3);

		int before = Json.of(displayStateOf(user)).get("relistQuotaPerPeriod").asInt();
		assertThat(relist(user, "ad-1").statusCode()).isEqualTo(200);
		int after = Json.of(displayStateOf(user)).get("relistQuotaPerPeriod").asInt();

		assertThat(before).isEqualTo(3);
		assertThat(after).isEqualTo(3);
	}

	/**
	 * <strong>Neither half of that pair on an unlimited tier</strong> (T73, #160; ADR-0029): both are
	 * {@code null}, and always together — one is the ceiling and the other is what is left under it, so a
	 * plan with no ceiling has neither. The popup draws the tier's name and "Unlimited reposts" from that,
	 * with no bar and no date, because a bar needs a proportion and there is nothing to draw one against.
	 */
	@Test
	void andNeitherOfThemOnATierWithNoCeiling() {
		Subscriber user = aSubscriberEntitledTo(null);
		assertThat(relist(user, "ad-1").statusCode()).isEqualTo(200);

		JsonNode state = Json.of(displayStateOf(user));

		assertThat(state.get("quotaRemaining").isNull()).isTrue();
		assertThat(state.get("relistQuotaPerPeriod").isNull()).isTrue();
		// The rest of the body is unchanged, so a client reading it has one field fewer to guess at rather
		// than a different shape to branch on.
		assertThat(state.get("resetAt").isNull()).isFalse();
		assertThat(state.get("tier").get("code").asString()).isNotEmpty();
	}

	/**
	 * What is left, not what the tier grants. A unit held is a unit spent until the extension says otherwise
	 * (#23), so an in-flight relist is already missing from the number the popup renders — the same rule the
	 * gate refuses by, which is what keeps a button locked while the quota beside it still reads three.
	 */
	@Test
	void theQuotaShownIsWhatThePeriodHasLeftRatherThanWhatTheTierGrants() {
		Subscriber user = aSubscriberEntitledTo(3);
		this.rows.unitHeldBy(user, Subscribers.now());

		assertThat(quotaShownTo(user)).isEqualTo(2);
	}

	/**
	 * And never below zero. A tier's quota is an operator's to edit at any time (ADR-0014), so a subscriber
	 * who has spent two can find themselves on a rung granting one — a state nobody has to do anything wrong
	 * to reach. A negative number in the popup is not a smaller quota, it is a bug on screen.
	 */
	@Test
	void andItIsNeverFewerThanNoneWhenATierIsLoweredUnderItsSubscribers() {
		Subscriber user = aSubscriberEntitledTo(1);
		this.rows.unitHeldBy(user, Subscribers.now());
		this.rows.unitHeldBy(user, Subscribers.now());

		assertThat(quotaShownTo(user)).isZero();
	}

	/**
	 * <strong>The number shown is the number the gate refuses on</strong>, which is the whole reason this
	 * endpoint asks {@code enforcement} rather than counting for itself. Spent through {@code /authorize}, so
	 * the two readers are held to one another over the same rows rather than to a fixture each.
	 *
	 * <p>The reset date is asserted to be the same date too: a refusal that named a different one would be a
	 * countdown in the popup that expires while the gate still refuses, or the reverse.
	 */
	@Test
	void theNumberShownIsTheNumberTheGateRefusesOn() {
		Subscriber user = aSubscriberEntitledTo(2);
		assertThat(relist(user, "ad-1").statusCode()).isEqualTo(200);
		assertThat(quotaShownTo(user)).isEqualTo(1);

		assertThat(relist(user, "ad-2").statusCode()).isEqualTo(200);
		JsonNode shown = Json.of(displayStateOf(user));
		HttpResponse<String> refused = relist(user, "ad-3");

		assertThat(shown.get("quotaRemaining").asInt()).isZero();
		assertThat(refused.statusCode()).isEqualTo(429);
		assertThat(Json.of(refused).get("reason").asString()).isEqualTo("QUOTA_EXCEEDED");
		assertThat(OffsetDateTime.parse(Json.of(refused).get("resetAt").asString())
				.withOffsetSameInstant(ZoneOffset.UTC)).isEqualTo(resetAtIn(shown));
	}

	/**
	 * A payer whose subscription lapsed is <em>shown</em> that it lapsed. Display state is never a grant
	 * (ADR-0007), so there is nothing here to fail closed about: the call that grants something refuses them
	 * with {@code SUBSCRIPTION_INACTIVE}, and this one is what the popup renders the upsell from — a caller
	 * refused here would have no way to tell a lapsed plan from a backend that is down.
	 */
	@Test
	void aPayerWhoseSubscriptionLapsedIsShownThatRatherThanTurnedAway() {
		Subscriber user = aSubscriberEntitledTo(3);
		this.rows.statusIs(user, "past_due");

		HttpResponse<String> shown = displayStateOf(user);

		assertThat(shown.statusCode()).isEqualTo(200);
		assertThat(Json.of(shown).get("subscriptionStatus").asString()).isEqualTo("PAST_DUE");
	}

	/**
	 * A free window that closed while nobody was looking is rolled before it is answered with — which matters
	 * here more than anywhere, because this is the call both clients make immediately after signing in. Left
	 * unrolled, a user returning after a month would be shown a {@code resetAt} in the past and a quota
	 * counted in a period that has ended, which reads as three relists they no longer have.
	 *
	 * <p>The units spent inside that old window go with it: usage is counted in the current period, so a
	 * subscriber whose month turned over is shown the whole of their tier's grant again.
	 */
	@Test
	void aFreeWindowThatHasClosedIsRolledBeforeItIsAnsweredWith() {
		Subscriber user = aSubscriberEntitledTo(3);
		OffsetDateTime signedUp = Subscribers.now().minusMonths(3);
		this.rows.provisionedAt(user, signedUp);
		this.rows.unitHeldBy(user, signedUp.plusDays(1));

		JsonNode shown = Json.of(displayStateOf(user));

		assertThat(shown.get("quotaRemaining").asInt()).isEqualTo(3);
		assertThat(resetAtIn(shown)).isAfter(Subscribers.now()).isEqualTo(this.rows.windowOf(user).end());
	}

	/**
	 * Asking what is left spends nothing, and that is the endpoint's defining property rather than a detail:
	 * a popup opened five times is five of these calls, and one that cost a unit would empty a free tier by
	 * being looked at. Nothing is reserved, and nothing is recorded either.
	 */
	@Test
	void askingWhatIsLeftSpendsNothing() {
		Subscriber user = aSubscriberEntitledTo(3);

		assertThat(quotaShownTo(user)).isEqualTo(3);
		assertThat(quotaShownTo(user)).isEqualTo(3);

		assertThat(this.rows.reservationsOf(user)).isEmpty();
		assertThat(this.rows.eventsOf(user)).isEmpty();
	}

	/**
	 * The first request carrying a subject this API has never seen is answered with the plan it has just
	 * provisioned. Declaring a {@link com.mprelist.identity.UserRef} is what creates the account and its
	 * default-tier subscription (#20), and this is the route the backlog named as the first to declare one —
	 * so a brand-new user's first call renders a real plan rather than failing on an account nobody made.
	 *
	 * <p>The default tier's own numbers are read back rather than written down here: which tier carries
	 * {@code is_default} and what it grants are the seed's to say and {@code TierCatalogSeedTest}'s to hold,
	 * and a copy of them in this suite would start failing the day an operator tuned the catalog.
	 */
	@Test
	void aSubjectThisApiHasNeverSeenIsShownThePlanItIsProvisionedOnto() {
		String newcomer = UUID.randomUUID().toString();

		HttpResponse<String> shown = displayStateOf(IDP.token(claims -> claims.subject(newcomer)));

		assertThat(shown.statusCode()).isEqualTo(200);
		Map<String, Object> provisionedOnto = theDefaultTier();
		JsonNode state = Json.of(shown);
		assertThat(state.get("subscriptionStatus").asString()).isEqualTo("ACTIVE");
		assertThat(state.get("tier").get("code").asString()).isEqualTo(provisionedOnto.get("code"));
		assertThat(state.get("quotaRemaining").asInt()).isEqualTo(provisionedOnto.get("relist_quota_per_period"));
	}

	/**
	 * Signed out is not a display state. The route is closed by the resource server like every other one
	 * (#19), so an unauthenticated caller is told they are unauthenticated rather than shown a plan belonging
	 * to nobody — and the extension's signed-out screen is what it renders from that.
	 */
	@Test
	void aCallerCarryingNoTokenIsShownNothingAtAll() {
		HttpResponse<String> refused = displayStateOf((String) null);

		assertThat(refused.statusCode()).isEqualTo(401);
		assertThat(Json.of(refused).get("reason").asString()).isEqualTo("UNAUTHENTICATED");
		assertThat(refused.headers().firstValue("WWW-Authenticate")).isPresent();
	}

	/**
	 * The tier is sent in both of its spellings, and the test is what an operator's rename does to each: the
	 * display name follows the edit and the code does not. That is the pair's whole reason for existing — a
	 * client branding a plan reads {@code code}, a client rendering one reads {@code name}, and neither ends
	 * up branching on text somebody is free to rewrite.
	 */
	@Test
	void theTierIsShownInBothOfItsSpellingsSoThatNobodyBrandsAPlanByItsLabel() {
		Subscriber user = aSubscriberEntitledTo(3);
		this.rows.tierIsCalled(user, "Renamed by an operator");

		JsonNode tier = Json.of(displayStateOf(user)).get("tier");

		assertThat(tier.get("name").asString()).isEqualTo("Renamed by an operator");
		assertThat(tier.get("code").asString()).isEqualTo(this.rows.tierOf(user).get("code"));
	}

	/**
	 * The flags travel as the object the column holds rather than as a list of names, so a flag that later
	 * carries a value ("bulk, up to 20 at a time") reaches a client in the same field it always did.
	 */
	@Test
	void theFlagsTheTierGrantsAreShownAsTheColumnHoldsThem() {
		Subscriber user = aSubscriberEntitledTo(3);
		this.rows.tierGrantsFeatures(user, "{\"bulk\": true, \"scheduling\": {\"perDay\": 4}}");

		JsonNode features = Json.of(displayStateOf(user)).get("features");

		assertThat(features.get("bulk").asBoolean()).isTrue();
		assertThat(features.get("scheduling").get("perDay").asInt()).isEqualTo(4);
	}

	/**
	 * And a tier granting none — which is every tier in the catalog today — sends an empty object rather than
	 * omitting the field: "this plan grants no flags" is an answer, where a missing field leaves a client
	 * guessing whether the API forgot or the plan is bare.
	 */
	@Test
	void andATierGrantingNoneShowsAnEmptyObjectRatherThanNothingAtAll() {
		Subscriber user = aSubscriberEntitledTo(3);

		JsonNode features = Json.of(displayStateOf(user)).get("features");

		assertThat(features.isObject()).isTrue();
		assertThat(features.isEmpty()).isTrue();
	}

	// --- the calls ----------------------------------------------------------------------------------------

	private HttpResponse<String> displayStateOf(Subscriber user) {
		return displayStateOf(user.token());
	}

	/**
	 * The call as both clients make it. A null token omits the header entirely rather than sending an empty
	 * one, which is {@link Relists}' distinction and the same one the resource server draws.
	 */
	private HttpResponse<String> displayStateOf(String token) {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + this.port + "/api/me"))
				.timeout(Duration.ofSeconds(20))
				.GET();
		return Http.send((token == null ? request : request.header("Authorization", "Bearer " + token)).build());
	}

	private HttpResponse<String> relist(Subscriber user, String adId) {
		return this.calls.authorizing(user, adId);
	}

	// --- reading back -------------------------------------------------------------------------------------

	private int quotaShownTo(Subscriber user) {
		return Json.of(displayStateOf(user)).get("quotaRemaining").asInt();
	}

	private static OffsetDateTime resetAtIn(JsonNode state) {
		return OffsetDateTime.parse(state.get("resetAt").asString()).withOffsetSameInstant(ZoneOffset.UTC);
	}

	/**
	 * The row a new account is provisioned onto, read rather than assumed — the same question
	 * {@code FirstLoginProvisioningTest} asks of the seed, about the columns this endpoint renders.
	 */
	private Map<String, Object> theDefaultTier() {
		return this.db.queryForMap("select code, name, relist_quota_per_period from tier where is_default");
	}

	/** @param relistsPerPeriod what a period grants, or {@code null} for unlimited (T73, ADR-0029) */
	private Subscriber aSubscriberEntitledTo(Integer relistsPerPeriod) {
		return this.rows.entitledTo(relistsPerPeriod);
	}

	@Autowired
	private JdbcTemplate db;

	@LocalServerPort
	private int port;

	/** The rows this suite arranges, under a tier prefix that tells them from the seeded catalog. */
	private Subscribers rows;

	/** The gate's own calls, for the one test that holds this endpoint's number against the gate's. */
	private Relists calls;

}
