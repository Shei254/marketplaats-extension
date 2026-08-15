package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import javax.sql.DataSource;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
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
import com.mprelist.Subscribers.Window;

import tools.jackson.databind.JsonNode;

/**
 * {@code POST /api/relist/complete}: what the extension says happened to the relist it was authorized for, what
 * that costs, and what it is told it has left (#23, {@code docs/enforcement-contract.md}).
 *
 * <p>Every call here is one the extension will make, and so is the {@code /api/relist/authorize} that precedes
 * it: a {@code jti} is a reservation this application issued, so the only honest way to arrange one is to ask
 * for it. The rows underneath — the tier, the subscription, a unit already held — are {@link Subscribers}', for
 * the reason {@link RelistAuthorizationTest} states: a lapsed payer or a window that closed three months ago is
 * a state no sequence of calls can produce.
 *
 * <p>Over a real port and not {@code @Transactional}, both for that suite's reasons.
 *
 * <p><strong>#24's reconciliation is out of reach here</strong>, which is what the interval buys: this suite
 * arranges reservations whose grants ran out in order to assert that a late report is still answered, and a
 * job refunding one of them mid-test would leave the test asserting something it did not arrange. What
 * reconciliation does with those rows is {@link ReservationReconciliationTest}'s subject, and the rule they
 * share — a report arriving after a refund still settles the unit — is asserted below.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = "mprelist.reconciliation.interval=24h")
@Import(PostgresFromCompose.class)
class RelistCompletionTest {

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
	void nothingHasBeenReportedYet() {
		this.rows = new Subscribers(this.db, IDP, "complete-suite-");
		this.rows.nobodyHasRelistedYet();
	}

	@AfterEach
	void stopCalling() {
		this.callers.shutdownNow();
	}

	/**
	 * A relist that worked spends the unit it was authorized for, and the caller is told what it has left —
	 * which is the point of answering with a quota rather than with an acknowledgement: a relist then needs no
	 * follow-up {@code /api/me} call to render the button it just used.
	 *
	 * <p>The body carries those two fields and nothing else. {@code /api/me} is the display state and this is
	 * not it (#26): a status or a tier answered here would be a second place the UI could read a subscription
	 * from, and the two would eventually disagree.
	 */
	@Test
	void aRelistReportedAsDoneSpendsTheUnitItWasAuthorizedFor() {
		Subscriber user = this.rows.entitledTo(3);
		UUID authorized = authorize(user, "ad-1");

		HttpResponse<String> reported = complete(user, authorized, "SUCCESS");

		assertThat(reported.statusCode()).isEqualTo(200);
		JsonNode left = Json.of(reported);
		assertThat(left.get("quotaRemaining").asInt()).isEqualTo(2);
		assertThat(OffsetDateTime.parse(left.get("resetAt").asString())).isEqualTo(this.rows.windowOf(user).end());
		assertThat(left.size()).isEqualTo(2);
		assertThat(this.rows.theOnlyReservationOf(user)).satisfies(spent -> {
			assertThat(spent.get("status")).isEqualTo("SETTLED");
			assertThat(Subscribers.utc(spent, "resolved_at")).isNotNull();
		});
		assertThat(this.rows.eventsOf(user)).singleElement()
				.satisfies(event -> assertThat(event.get("outcome")).isEqualTo("SUCCESS"));
	}

	/**
	 * And so does one that failed once the ad was already gone. {@code FAILED_AFTER_DELETE} is the worst thing
	 * that can happen to a user and still costs them the unit: the destructive half of ADR-0003's delete-first
	 * flow happened, and a quota that gave the unit back would let a broken relist loop burn a seller's
	 * listings for free.
	 */
	@Test
	void andSoDoesOneThatFailedOnceTheAdWasAlreadyDeleted() {
		Subscriber user = this.rows.entitledTo(3);
		UUID authorized = authorize(user, "ad-1");

		HttpResponse<String> reported = complete(user, authorized, "FAILED_AFTER_DELETE");

		assertThat(Json.of(reported).get("quotaRemaining").asInt()).isEqualTo(2);
		assertThat(this.rows.theOnlyReservationOf(user).get("status")).isEqualTo("SETTLED");
	}

	/**
	 * But one that failed before anything was deleted gives the unit back. Nothing was consumed on Marktplaats,
	 * so nothing is consumed here — which is the reason {@code /complete} exists at all beyond telemetry:
	 * counting at authorize alone would charge a free user one of three relists for a call that never reached
	 * the site.
	 */
	@Test
	void butOneThatFailedBeforeTheAdWasTouchedGivesTheUnitBack() {
		Subscriber user = this.rows.entitledTo(3);
		UUID authorized = authorize(user, "ad-1");

		HttpResponse<String> reported = complete(user, authorized, "FAILED_BEFORE_DELETE");

		assertThat(Json.of(reported).get("quotaRemaining").asInt()).isEqualTo(3);
		assertThat(this.rows.theOnlyReservationOf(user).get("status")).isEqualTo("REFUNDED");
	}

	/**
	 * And it is recorded even though it cost nothing, which is the whole of why the event table is not the
	 * usage count. We drive private endpoints ADR-0004 says will change without notice, and a rising
	 * {@code FAILED_BEFORE_DELETE} rate is the first sign that Marktplaats moved something — a table that kept
	 * only the relists that worked would be blind to exactly the failure it exists to reveal.
	 */
	@Test
	void andIsRecordedAllTheSameBecauseThatMixIsTheBreakageCanary() {
		Subscriber user = this.rows.entitledTo(3);

		complete(user, authorize(user, "ad-1"), "FAILED_BEFORE_DELETE");

		assertThat(this.rows.eventsOf(user)).singleElement()
				.satisfies(event -> assertThat(event.get("outcome")).isEqualTo("FAILED_BEFORE_DELETE"));
	}

	/**
	 * The number answered here is the one the gate goes on to enforce. Two subtractions written a day apart are
	 * two chances for the popup to show a relist left beside a button that refuses, so both come off one
	 * calculation — and the {@code resetAt} a quota denial carries is the same instant this call reported.
	 */
	@Test
	void theQuotaItAnswersWithIsTheOneTheGateThenEnforces() {
		Subscriber user = this.rows.entitledTo(2);
		complete(user, authorize(user, "ad-1"), "SUCCESS");
		HttpResponse<String> spent = complete(user, authorize(user, "ad-2"), "SUCCESS");

		assertThat(Json.of(spent).get("quotaRemaining").asInt()).isZero();

		HttpResponse<String> refused = authorizing(user, "ad-3");
		assertThat(refused.statusCode()).isEqualTo(429);
		assertThat(Json.of(refused).get("reason").asString()).isEqualTo("QUOTA_EXCEEDED");
		assertThat(Json.of(refused).get("resetAt").asString()).isEqualTo(Json.of(spent).get("resetAt").asString());
	}

	/**
	 * A tier whose quota was lowered under a subscriber leaves them holding more than it grants, and what they
	 * are told they have left is nothing — not less than nothing. A tier's numbers are an operator's to edit at
	 * any time (ADR-0014), so this is reachable without anybody doing anything wrong, and a negative number
	 * rendered in the popup is not a smaller quota but a bug on screen.
	 *
	 * <p>It is the same clamp the gate refuses on, which is why this asserts both halves: "nothing left" and
	 * "refused" have to be the same condition, or one of them is a button that offers what the other denies.
	 */
	@Test
	void aQuotaLoweredUnderASubscriberLeavesThemWithNothingRatherThanLessThanNothing() {
		Subscriber user = this.rows.entitledTo(1);
		UUID spentUnderTheOldQuota = this.rows.unitHeldBy(user, Subscribers.now().minusHours(2));
		this.rows.unitHeldBy(user, Subscribers.now().minusHours(1));

		HttpResponse<String> reported = complete(user, spentUnderTheOldQuota, "SUCCESS");

		assertThat(Json.of(reported).get("quotaRemaining").asInt()).isZero();
		assertThat(authorizing(user, "ad-1").statusCode()).isEqualTo(429);
	}

	/**
	 * The same report twice costs what it cost the first time. The ordinary cause of a second one is an
	 * extension that retried because our answer never arrived, so it is answered with the quota as it stands
	 * rather than with an error the client would have to tell apart from a real failure.
	 */
	@Test
	void theSameReportTwiceCostsWhatTheFirstOneCost() {
		Subscriber user = this.rows.entitledTo(3);
		UUID authorized = authorize(user, "ad-1");

		HttpResponse<String> first = complete(user, authorized, "SUCCESS");
		HttpResponse<String> again = complete(user, authorized, "SUCCESS");

		assertThat(again.statusCode()).isEqualTo(200);
		assertThat(Json.of(again).get("quotaRemaining").asInt()).isEqualTo(2);
		assertThat(again.body()).isEqualTo(first.body());
		assertThat(this.rows.eventsOf(user)).hasSize(1);
	}

	/**
	 * And a second report cannot revise what the first one said. A {@code FAILED_BEFORE_DELETE} arriving after a
	 * {@code SUCCESS} would otherwise hand back the unit for a relist that happened — and under ADR-0007 the
	 * client sending it is the adversary, so the rule is the first report wins rather than the last.
	 */
	@Test
	void andASecondReportCannotReviseWhatTheFirstOneSaid() {
		Subscriber user = this.rows.entitledTo(3);
		UUID authorized = authorize(user, "ad-1");
		complete(user, authorized, "SUCCESS");

		HttpResponse<String> revised = complete(user, authorized, "FAILED_BEFORE_DELETE");

		assertThat(Json.of(revised).get("quotaRemaining").asInt()).isEqualTo(2);
		assertThat(this.rows.theOnlyReservationOf(user).get("status")).isEqualTo("SETTLED");
		assertThat(this.rows.eventsOf(user)).singleElement()
				.satisfies(event -> assertThat(event.get("outcome")).isEqualTo("SUCCESS"));
	}

	/** Nor the other way round: a unit given back stays given back, and the canary keeps the failure. */
	@Test
	void andNorTheOtherWayRound() {
		Subscriber user = this.rows.entitledTo(3);
		UUID authorized = authorize(user, "ad-1");
		complete(user, authorized, "FAILED_BEFORE_DELETE");

		HttpResponse<String> revised = complete(user, authorized, "SUCCESS");

		assertThat(Json.of(revised).get("quotaRemaining").asInt()).isEqualTo(3);
		assertThat(this.rows.theOnlyReservationOf(user).get("status")).isEqualTo("REFUNDED");
		assertThat(this.rows.eventsOf(user)).singleElement()
				.satisfies(event -> assertThat(event.get("outcome")).isEqualTo("FAILED_BEFORE_DELETE"));
	}

	/**
	 * A reservation somebody else holds is not this caller's to resolve. Settling one would cost its owner
	 * nothing extra, but refunding it hands them quota they did not earn — and either way it writes an event
	 * misreporting what Marktplaats did to whoever is reading the canary.
	 *
	 * <p>{@code 404} with <strong>no reason code</strong>, which is the contract's shape for a {@code 4xx} that
	 * is not a denial: this caller was not turned away, they named something that is not theirs.
	 */
	@Test
	void aReservationSomebodyElseHoldsIsNotThisCallersToResolve() {
		Subscriber owner = this.rows.entitledTo(3);
		Subscriber somebodyElse = this.rows.entitledTo(3);
		UUID theirs = authorize(owner, "ad-1");

		HttpResponse<String> refused = complete(somebodyElse, theirs, "FAILED_BEFORE_DELETE");

		assertThat(refused.statusCode()).isEqualTo(404);
		assertThat(refused.body()).doesNotContain("reason");
		assertThat(this.rows.theOnlyReservationOf(owner).get("status")).isEqualTo("RESERVED");
		assertThat(this.rows.eventsOf(owner)).isEmpty();
	}

	/**
	 * And a {@code jti} naming no reservation at all is answered the same way, on purpose: a client that could
	 * tell "never existed" from "not yours" would have been handed a way to ask whether a given id is
	 * anybody's.
	 */
	@Test
	void andNorIsOneThisApiNeverIssued() {
		Subscriber user = this.rows.entitledTo(3);

		HttpResponse<String> refused = complete(user, UUID.randomUUID(), "SUCCESS");

		assertThat(refused.statusCode()).isEqualTo(404);
		assertThat(refused.body()).doesNotContain("reason");
	}

	/**
	 * And it leaves the subscription alone on the way to saying so. The {@code jti} is the one input to this
	 * call an adversary picks (ADR-0007), and reading a subscription is not free of consequence: {@code
	 * currentFor} takes a write lock on the caller's row and rolls a free window that has closed. Asking whose
	 * the reservation is first means a value nobody issued moves nothing at all — the window this arranges as
	 * three months stale is still stale afterwards.
	 *
	 * <p>The owner of a reservation never changes, so nothing is lost by asking before the lock rather than
	 * under it.
	 */
	@Test
	void andAJtiThatIsNobodysRollsNoWindowOnTheWayToSayingSo() {
		Subscriber user = this.rows.entitledTo(3);
		this.rows.provisionedAt(user, Subscribers.now().minusMonths(3));
		Window stale = this.rows.windowOf(user);

		HttpResponse<String> refused = complete(user, UUID.randomUUID(), "SUCCESS");

		assertThat(refused.statusCode()).isEqualTo(404);
		assertThat(this.rows.windowOf(user)).isEqualTo(stale);
		assertThat(stale.end()).isBefore(Subscribers.now());
	}

	/** A call carrying no token resolves nothing, because it reaches no handler at all (#19). */
	@Test
	void aReportWithNoTokenResolvesNothingAndIsToldToSignIn() {
		Subscriber user = this.rows.entitledTo(3);
		UUID authorized = authorize(user, "ad-1");

		HttpResponse<String> refused = complete(null, "{\"jti\": \"" + authorized + "\", \"outcome\": \"SUCCESS\"}");

		assertThat(refused.statusCode()).isEqualTo(401);
		assertThat(Json.of(refused).get("reason").asString()).isEqualTo("UNAUTHENTICATED");
		assertThat(this.rows.theOnlyReservationOf(user).get("status")).isEqualTo("RESERVED");
	}

	/**
	 * A body naming no authorization is a request this API could not read rather than a caller it turned away,
	 * so it comes back as a {@code 400} carrying no reason code.
	 */
	@Test
	void aBodyNamingNoAuthorizationIsARequestThisApiCouldNotRead() {
		Subscriber user = this.rows.entitledTo(3);
		authorize(user, "ad-1");

		HttpResponse<String> unread = complete(user.token(), """
				{"outcome": "SUCCESS"}""");

		assertThat(unread.statusCode()).isEqualTo(400);
		assertThat(unread.body()).doesNotContain("reason");
		assertThat(this.rows.theOnlyReservationOf(user).get("status")).isEqualTo("RESERVED");
	}

	/**
	 * And so is one saying nothing about what happened. There is no outcome to assume for a report that does not
	 * carry one: read as a success it would settle a unit nobody said was spent, and read as a failure it would
	 * refund one. An unreported relist is #24's to reconcile, not this call's to guess at.
	 */
	@Test
	void andSoIsOneSayingNothingAboutWhatHappened() {
		Subscriber user = this.rows.entitledTo(3);
		UUID authorized = authorize(user, "ad-1");

		HttpResponse<String> unread = complete(user.token(), "{\"jti\": \"" + authorized + "\"}");

		assertThat(unread.statusCode()).isEqualTo(400);
		assertThat(unread.body()).doesNotContain("reason");
		assertThat(this.rows.theOnlyReservationOf(user).get("status")).isEqualTo("RESERVED");
	}

	/**
	 * An outcome this contract does not name is refused on the way in rather than at the check constraint. A
	 * spelling nobody checked would otherwise arrive as a {@code 500} at the end of a relist the user has
	 * already performed — and the unit would stay held for a report they did make.
	 */
	@Test
	void andAnOutcomeThisContractDoesNotNameIsRefusedOnTheWayIn() {
		Subscriber user = this.rows.entitledTo(3);
		UUID authorized = authorize(user, "ad-1");

		HttpResponse<String> unread = complete(user, authorized, "NEARLY_WORKED");

		assertThat(unread.statusCode()).isEqualTo(400);
		assertThat(unread.body()).doesNotContain("reason");
		assertThat(this.rows.theOnlyReservationOf(user).get("status")).isEqualTo("RESERVED");
	}

	/**
	 * A {@code jti} shaped like anything other than the id of a reservation is unreadable rather than
	 * unfindable, and the two have different answers: a {@code 400} says the extension is sending something
	 * this API does not accept, where the {@code 404} above says the authorization it is reporting on is not
	 * one of this caller's. An extension that could not tell them apart would retry the one it should fix.
	 */
	@Test
	void andAJtiShapedLikeNoAuthorizationWeEverIssuedIsUnreadableRatherThanUnfindable() {
		Subscriber user = this.rows.entitledTo(3);

		HttpResponse<String> unread = complete(user.token(), """
				{"jti": "not-an-authorization", "outcome": "SUCCESS"}""");

		assertThat(unread.statusCode()).isEqualTo(400);
		assertThat(unread.body()).doesNotContain("reason");
	}

	/**
	 * A payer whose subscription stopped between the authorize and the report is still the only witness to what
	 * happened on Marktplaats. Refusing them would hold their unit for the rest of the period and lose exactly
	 * the outcome the canary is watching for — this call grants nothing, so there is nothing here to fail closed
	 * about.
	 */
	@Test
	void aLapsedPayerCanStillReportWhatHappenedToTheRelistTheyWereAuthorizedFor() {
		Subscriber user = this.rows.entitledTo(3);
		UUID authorized = authorize(user, "ad-1");
		this.rows.statusIs(user, "past_due");

		HttpResponse<String> reported = complete(user, authorized, "FAILED_BEFORE_DELETE");

		assertThat(reported.statusCode()).isEqualTo(200);
		assertThat(this.rows.theOnlyReservationOf(user).get("status")).isEqualTo("REFUNDED");
	}

	/**
	 * And so can one whose grant has already expired. The 45 seconds bound how long an <em>authorization</em> is
	 * good for, not how long the extension has to say what it did with one — and the reports that arrive late
	 * are the slow and broken relists, which are the ones worth hearing about.
	 */
	@Test
	void andSoCanOneWhoseGrantExpiredLongBeforeTheReportArrived() {
		Subscriber user = this.rows.entitledTo(3);
		UUID authorized = authorize(user, "ad-1");
		expired(authorized);

		HttpResponse<String> reported = complete(user, authorized, "SUCCESS");

		assertThat(reported.statusCode()).isEqualTo(200);
		assertThat(this.rows.theOnlyReservationOf(user).get("status")).isEqualTo("SETTLED");
	}

	/**
	 * A relist begun in one window and reported in the next is answered with the window that is current now.
	 * The report still resolves its reservation — that unit belonged to the period it was taken in — but
	 * {@code resetAt} is never a date that has passed, which is what the popup renders as a cooldown that is
	 * already over.
	 */
	@Test
	void aReportArrivingAfterTheWindowRolledIsAnsweredWithTheOneThatIsCurrentNow() {
		Subscriber user = this.rows.entitledTo(3);
		UUID authorized = authorize(user, "ad-1");
		this.rows.provisionedAt(user, Subscribers.now().minusMonths(3));

		HttpResponse<String> reported = complete(user, authorized, "SUCCESS");

		OffsetDateTime resetAt = OffsetDateTime.parse(Json.of(reported).get("resetAt").asString());
		assertThat(resetAt).isAfter(Subscribers.now()).isEqualTo(this.rows.windowOf(user).end());
		assertThat(Json.of(reported).get("quotaRemaining").asInt()).isEqualTo(3);
		assertThat(this.rows.theOnlyReservationOf(user).get("status")).isEqualTo("SETTLED");
	}

	/**
	 * A reservation already refunded for want of a report is put back on the strength of one that finally
	 * arrives. Reconciliation (#24) refunds an abandoned unit because nothing said what became of it; the report
	 * is the only account of what actually happened on Marktplaats, so it wins over the guess made in its
	 * absence.
	 *
	 * <p>Arranged as a refund with no event beside it, which is what #24 leaves behind: it has no outcome to
	 * record, since the three the contract names are all things the extension observed.
	 */
	@Test
	void aReportForAUnitAlreadyRefundedForWantOfOneIsStillTheAccountOfWhatHappened() {
		Subscriber user = this.rows.entitledTo(3);
		UUID abandoned = this.rows.unitHeldBy(user, Subscribers.now().minusHours(2));
		this.rows.refunded(abandoned);

		HttpResponse<String> reported = complete(user, abandoned, "SUCCESS");

		assertThat(reported.statusCode()).isEqualTo(200);
		assertThat(Json.of(reported).get("quotaRemaining").asInt()).isEqualTo(2);
		assertThat(this.rows.theOnlyReservationOf(user).get("status")).isEqualTo("SETTLED");
	}

	/**
	 * The subscription row is held for the length of the call, which is what makes the number answered here the
	 * one that is true after this report rather than one from the middle of another call of the same user's. It
	 * is also what rolls a closed window before anything is counted in it.
	 *
	 * <p>Asserted as the mechanism for {@link RelistAuthorizationTest}'s reason: the row is locked on a
	 * connection of this suite's own, and the call is then observed waiting on it. A read that skipped the lock
	 * would answer immediately, which is what this fails on.
	 */
	@Test
	void theSubscriptionIsHeldForTheLengthOfTheCallReportingAgainstIt() throws Exception {
		Subscriber user = this.rows.entitledTo(3);
		UUID authorized = authorize(user, "ad-1");
		try (Connection somebodyElse = this.database.getConnection()) {
			somebodyElse.setAutoCommit(false);
			this.rows.lockTheSubscriptionOf(somebodyElse, user);

			Future<HttpResponse<String>> inFlight = this.callers.submit(() -> complete(user, authorized, "SUCCESS"));
			BlockedBackends.awaitAtLeast(1, this.db, Duration.ofSeconds(15));

			assertThat(inFlight.isDone()).isFalse();
			somebodyElse.rollback();
			assertThat(inFlight.get(30, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
		}
	}

	// --- the calls --------------------------------------------------------------------------------------

	private HttpResponse<String> complete(Subscriber user, UUID jti, String outcome) {
		return complete(user.token(), "{\"jti\": \"" + jti + "\", \"outcome\": \"" + outcome + "\"}");
	}

	private HttpResponse<String> complete(String token, String body) {
		return post("/api/relist/complete", token, body);
	}

	/**
	 * The authorization being reported on, taken the way the extension takes one. Arranging a reservation row
	 * directly would be arranging a {@code jti} this API never issued, which is the subject of one test above
	 * and not of the rest.
	 */
	private UUID authorize(Subscriber user, String adId) {
		HttpResponse<String> granted = authorizing(user, adId);
		assertThat(granted.statusCode()).isEqualTo(200);
		return UUID.fromString(Json.of(granted).get("jti").asString());
	}

	private HttpResponse<String> authorizing(Subscriber user, String adId) {
		return post("/api/relist/authorize", user.token(), "{\"adId\": \"" + adId + "\"}");
	}

	private HttpResponse<String> post(String path, String token, String body) {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + this.port + path))
				.timeout(Duration.ofSeconds(20))
				.header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
		return Http.send((token == null ? request : request.header("Authorization", "Bearer " + token)).build());
	}

	// --- arrangement and reading back -------------------------------------------------------------------

	/** A grant that has run out, as one has by the time a slow relist reports on it. */
	private void expired(UUID reservation) {
		this.rows.grantRanOutAt(reservation, Subscribers.now().minusMinutes(10));
	}

	@Autowired
	private JdbcTemplate db;

	/** For the one test that holds a row of its own across a call the application makes. */
	@Autowired
	private DataSource database;

	@LocalServerPort
	private int port;

	private final ExecutorService callers = Executors.newFixedThreadPool(1);

	/** The rows this suite arranges, under a tier prefix of its own — see {@link Subscribers}. */
	private Subscribers rows;

}
