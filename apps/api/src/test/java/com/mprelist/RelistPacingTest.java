package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.sql.SQLException;
import java.time.Duration;
import java.time.OffsetDateTime;

import javax.sql.DataSource;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.mprelist.Subscribers.Subscriber;

/**
 * The SafetyPolicy check of {@code POST /api/relist/authorize}: how fast one account may relist, and what it
 * is told when it is going faster (#25, ADR-0008, {@code docs/enforcement-contract.md}).
 *
 * <p><strong>The rails are a rail for the user's own Marktplaats account.</strong> Relisting is
 * delete-and-recreate against a private API, so the account that gets flagged for a machine-shaped rhythm is
 * the seller's, and none of this is about our own load. Jitter <em>around</em> the interval is the extension's
 * (#54) and cannot be anything else: a backend can refuse a call that came too soon, it cannot make one arrive
 * at a human-shaped moment.
 *
 * <p><strong>This suite overrides none of the three settings</strong>, so what it is written against is what
 * the application ships — and {@link #theShippedRailsAreBothOnesThatCanBind()} is what holds those numbers in
 * the range the tests below assume. It is the same choice {@link ReservationReconciliationTest} makes about
 * the grace window, and for the same reason: a rail is a judgement about the world, and a suite that set its
 * own would be asserting arithmetic that {@code RelistPaceTest} already covers without a database.
 *
 * <p>Which is also the split. Every edge of the arithmetic — the exact instant an interval runs out, which of
 * two rails answers, how a wait is rounded — is {@code RelistPaceTest}'s, because reaching those through HTTP
 * would mean landing an arrangement on a clock this suite does not control. What is here is what only the
 * running application can answer: that the gate refuses on this at all, that it reads the rows it should and
 * only this caller's, where the check falls in the contract's order, and the shape of the refusal on the wire.
 *
 * <p>Prior relists are arranged as rows for the same reason {@link Subscribers#grantRanOutAt} exists: the rail
 * measures elapsed time, and thirty seconds is not a thing a test can wait out. The one case that needs no
 * arranging is the one the extension actually produces — two calls in a row — and that one is made for real.
 *
 * <p>Over a real port, not {@code @Transactional}, and with #24's reconciliation out of reach: all three for
 * {@link RelistAuthorizationTest}'s reasons.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = "mprelist.reconciliation.interval=24h")
@Import(PostgresFromCompose.class)
class RelistPacingTest {

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
	void nobodyIsGoingTooFastYet() {
		this.rows = new Subscribers(this.db, IDP, "pacing-suite-");
		this.calls = new Relists(this.port);
		this.rows.nobodyHasRelistedYet();
	}

	/**
	 * Two relists in the same breath: the second is refused, and told how long to wait rather than merely
	 * that it may not. A cooldown a user cannot see the end of is indistinguishable from an extension that has
	 * hung, and the reason code is what the popup renders as a timer instead of an error (#34).
	 *
	 * <p>The wait is at most the interval, because it is what is <em>left</em> of one that has already started
	 * running — a refusal that answered with the whole interval would keep adding it back at every attempt.
	 *
	 * <p>No {@code resetAt}. This caller's quota is not the problem and there is no window in which it becomes
	 * one, so a field arriving as null would invite the extension to render a reset date belonging to a
	 * different refusal entirely.
	 */
	@Test
	void aSecondRelistTheMomentAfterTheFirstIsToldHowLongToWait() {
		Subscriber user = aSubscriberWhoseQuotaIsNotTheSubject();
		this.calls.authorized(user, "ad-1");

		HttpResponse<String> refused = authorize(user, "ad-2");

		assertThat(refused.statusCode()).isEqualTo(429);
		assertThat(Json.of(refused).get("reason").asString()).isEqualTo("RATE_LIMITED");
		assertThat(Json.of(refused).get("retryAfter").asLong()).isPositive()
				.isLessThanOrEqualTo(this.minimumInterval.toSeconds());
		assertThat(Json.of(refused).has("resetAt")).isFalse();
	}

	/**
	 * And the refusal costs nothing but the wait. The check runs before the reservation for exactly this
	 * reason: a rail that spent the unit it refused to let somebody spend would turn a user relisting too
	 * eagerly into a user with no quota left, and every retry would dig the hole deeper.
	 */
	@Test
	void andTheRefusalCostsNothingButTheWait() {
		Subscriber user = aSubscriberWhoseQuotaIsNotTheSubject();
		this.calls.authorized(user, "ad-1");

		authorize(user, "ad-2");

		assertThat(this.rows.reservationsOf(user)).hasSize(1);
	}

	/** One far enough after the last is authorized, which is the rail letting go rather than a cap. */
	@Test
	void andOneFarEnoughAfterTheLastIsAuthorized() {
		Subscriber user = aSubscriberWhoseQuotaIsNotTheSubject();
		this.rows.unitHeldBy(user, Subscribers.now().minus(this.minimumInterval).minusSeconds(1));

		assertThat(authorize(user, "ad-1").statusCode()).isEqualTo(200);
	}

	/**
	 * A relist that failed before anything was deleted still paces the next one, and this is where the pacing
	 * read and the quota read part company. {@code FAILED_BEFORE_DELETE} hands the unit back (#23) because
	 * nothing was consumed on Marktplaats — but the attempt happened: an ad was captured, photos were fetched,
	 * requests were made from the user's own session. A rail that forgave every failure would stop pacing an
	 * extension exactly when it started failing, which is the moment it is hammering hardest.
	 */
	@Test
	void aRelistThatFailedBeforeAnythingWasDeletedStillPacesTheNextOne() {
		Subscriber user = aSubscriberWhoseQuotaIsNotTheSubject();
		this.rows.refunded(this.rows.unitHeldBy(user, Subscribers.now()));

		HttpResponse<String> refused = authorize(user, "ad-1");

		assertThat(refused.statusCode()).isEqualTo(429);
		assertThat(Json.of(refused).get("reason").asString()).isEqualTo("RATE_LIMITED");
	}

	/** But somebody else's relist is not this caller's to wait for: the rail is per account, like the quota. */
	@Test
	void butSomebodyElsesRelistIsNotThisCallersToWaitFor() {
		Subscriber user = aSubscriberWhoseQuotaIsNotTheSubject();
		this.rows.unitHeldBy(aSubscriberWhoseQuotaIsNotTheSubject(), Subscribers.now());

		assertThat(authorize(user, "ad-1").statusCode()).isEqualTo(200);
	}

	/**
	 * A window full of relists is refused though every one of them was far enough from the last — which is why
	 * there are two rails and not one. The interval alone permits a relist every thirty seconds forever, which
	 * is a hundred and twenty an hour at a rhythm no human has; the cap is what says a volley may not simply
	 * run all day.
	 *
	 * <p>The wait proves which rail answered: it is longer than the whole interval, so it can only have been
	 * measured from the relist that has to leave the window rather than from the last one made.
	 */
	@Test
	void aWindowFullOfRelistsIsRefusedThoughEveryOneOfThemWasFarEnoughFromTheLast() {
		Subscriber user = aSubscriberWhoseQuotaIsNotTheSubject();
		relistedAcrossTheWindow(user, this.burstLimit);

		HttpResponse<String> refused = authorize(user, "ad-1");

		assertThat(refused.statusCode()).isEqualTo(429);
		assertThat(Json.of(refused).get("reason").asString()).isEqualTo("RATE_LIMITED");
		assertThat(Json.of(refused).get("retryAfter").asLong())
				.isGreaterThan(this.minimumInterval.toSeconds())
				.isLessThanOrEqualTo(this.burstWindow.toSeconds());
	}

	/** And one short of the cap is not a cap — the window has room, so nothing here refuses. */
	@Test
	void andOneShortOfThatCapIsAuthorized() {
		Subscriber user = aSubscriberWhoseQuotaIsNotTheSubject();
		relistedAcrossTheWindow(user, this.burstLimit - 1);

		assertThat(authorize(user, "ad-1").statusCode()).isEqualTo(200);
	}

	/**
	 * A caller with nothing left this period is told <em>that</em>, not told to wait — and this is the test of
	 * the order, since both refusals apply. Waiting is advice that comes true; a quota that is spent does not
	 * come back in thirty seconds, so a cooldown timer here would run to zero in front of a user and then
	 * refuse them anyway, and the one thing they could act on — a bigger plan — would be the thing they were
	 * not told.
	 */
	@Test
	void aCallerWithNothingLeftThisPeriodIsToldSoRatherThanToldToWait() {
		Subscriber user = this.rows.entitledTo(1);
		this.rows.unitHeldBy(user, Subscribers.now());

		HttpResponse<String> refused = authorize(user, "ad-1");

		assertThat(refused.statusCode()).isEqualTo(429);
		assertThat(Json.of(refused).get("reason").asString()).isEqualTo("QUOTA_EXCEEDED");
		assertThat(Json.of(refused).has("retryAfter")).isFalse();
	}

	/**
	 * What the application ships, which every test above is written against and none of them would notice
	 * going wrong.
	 *
	 * <p><strong>Both rails have to be ones that can bind.</strong> An interval of nothing is a rail switched
	 * off, and a window shorter than the cap times the interval is a cap arithmetic can never reach — the
	 * interval alone would keep the count under it, forever, and the burst rail would be dead configuration
	 * that reads exactly like live configuration. A rail written off by arithmetic is one nobody decided to
	 * switch off, which is the failure this exists to catch.
	 *
	 * <p>The range beside it is what the tests above assume: an interval long enough that a call made
	 * immediately after another is inside it, short enough to be a pause rather than a lockout; a cap small
	 * enough that a test can arrange a window full of relists; a window long enough to be worth capping in.
	 */
	@Test
	void theShippedRailsAreBothOnesThatCanBind() {
		assertThat(this.minimumInterval).isPositive();
		assertThat(this.minimumInterval.multipliedBy(this.burstLimit)).isLessThan(this.burstWindow);

		assertThat(this.minimumInterval).isBetween(Duration.ofSeconds(5), Duration.ofMinutes(5));
		assertThat(this.burstLimit).isBetween(2, 100);
		assertThat(this.burstWindow).isBetween(Duration.ofMinutes(10), Duration.ofDays(1));
	}

	/**
	 * And the pace is read through an index rather than by reading every relist this caller ever made. This
	 * runs on the hot path of every authorization, against a table that gains a row per relist and never loses
	 * one, so without {@code usage_reservation_by_when_it_was_taken} (V4) the cost of relisting would grow with
	 * how much the product has ever done.
	 *
	 * <p>V1's index leads with the same two columns and still cannot serve this: it is <em>partial</em> on
	 * {@code status <> 'REFUNDED'}, and the statement here deliberately says nothing about status — a refunded
	 * relist paces the next one, as above. So the plan is the subject rather than the index's existence, since
	 * those are exactly what come apart.
	 *
	 * <p>Costs are not asserted, only that an index <em>can</em> serve the predicate — see {@link QueryPlans}.
	 */
	@Test
	void andThePaceIsReadThroughAnIndexRatherThanByReadingEveryRelistThisCallerEverMade() throws SQLException {
		String plan = QueryPlans.of(this.database, """
				select reserved_at from usage_reservation
				where app_user_id = '00000000-0000-0000-0000-000000000000' and reserved_at >= now()
				order by reserved_at desc
				limit 10
				""");

		assertThat(plan).contains("usage_reservation_by_when_it_was_taken");
	}

	// --- the call itself --------------------------------------------------------------------------------

	private HttpResponse<String> authorize(Subscriber user, String adId) {
		return this.calls.authorizing(user, adId);
	}

	// --- arrangement ------------------------------------------------------------------------------------

	/**
	 * A subscriber with more quota than any test here spends, since what is being asked throughout is how fast
	 * they may relist and not how often — a tier that ran out mid-test would answer with the wrong refusal for
	 * the right-looking reason.
	 */
	private Subscriber aSubscriberWhoseQuotaIsNotTheSubject() {
		return this.rows.entitledTo(this.burstLimit * 2);
	}

	/**
	 * That many relists, all inside the burst window and every one of them older than the interval — a caller
	 * who has paced themselves perfectly and is refused anyway, or is not, depending on how many there are.
	 *
	 * <p>Bunched at the far half of the window rather than spread across it, so that what has to elapse before
	 * the cap frees up is a good half of the window: a wait that could only have come from the burst rail, and
	 * not one an interval could be mistaken for.
	 */
	private void relistedAcrossTheWindow(Subscriber user, int relists) {
		OffsetDateTime halfwayBack = Subscribers.now().minus(this.burstWindow.dividedBy(2));
		for (int relist = 0; relist < relists; relist++) {
			this.rows.unitHeldBy(user, halfwayBack.plusSeconds(relist));
		}
	}

	@Autowired
	private JdbcTemplate db;

	/** For the one test whose subject is how Postgres reaches the rows the rail reads. */
	@Autowired
	private DataSource database;

	@LocalServerPort
	private int port;

	/**
	 * The rails as the application binds them, which is what {@code application.yml} ships since this suite
	 * overrides none of them — read here rather than written into each test, so that an operator retuning a
	 * number moves the arrangements with it instead of breaking them.
	 */
	@Value("${mprelist.safety.minimum-interval}")
	private Duration minimumInterval;

	@Value("${mprelist.safety.burst-limit}")
	private int burstLimit;

	@Value("${mprelist.safety.burst-window}")
	private Duration burstWindow;

	/** The rows this suite arranges, under a tier prefix of its own — see {@link Subscribers}. */
	private Subscribers rows;

	/** The gate's own calls, over {@link #port} — see {@link Relists}. */
	private Relists calls;

}
