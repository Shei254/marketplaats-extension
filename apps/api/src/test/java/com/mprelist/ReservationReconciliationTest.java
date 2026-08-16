package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.Map;
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
import org.springframework.boot.convert.DurationStyle;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.config.FixedDelayTask;
import org.springframework.scheduling.config.ScheduledTask;
import org.springframework.scheduling.config.ScheduledTaskHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.mprelist.Subscribers.Subscriber;

/**
 * The reconciliation of #24: the relists nothing ever reported on, and the units they are still holding.
 *
 * <p>The reservations are taken the way the extension takes one, through {@code /api/relist/authorize}, and
 * the only thing arranged behind the application's back is <em>when the grant ran out</em> — the 45 seconds an
 * authorization is good for cannot be waited out in a test, and a reservation written directly would be a
 * {@code jti} this API never issued. What the unit is worth afterwards is asked of the gate itself, because a
 * refund nobody can spend is not a refund.
 *
 * <p><strong>The job is run, not waited for.</strong> The interval below is long enough that the schedule
 * never fires during this suite, and each test invokes the task the scheduler holds — so every assertion is
 * about a reconciliation that provably happened, and the negative ones ("this row was left alone") are not
 * claims about a job that may simply not have got to the row yet. It is reached through
 * {@link ScheduledTaskHolder} rather than by naming the bean, which keeps the class in {@code enforcement}'s
 * {@code internal} package where it belongs and makes the wiring part of what is asserted: a job that stopped
 * being scheduled is one this suite cannot find to run.
 *
 * <p>The grace window is <em>not</em> overridden. It is the number the application ships with that decides
 * whether a relist still running is guessed abandoned, so these tests are written against it and
 * {@link #theShippedGraceIsLongerThanAnyRelistAndShorterThanTheirPatience()} is what holds it in the range
 * they assume.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = "mprelist.reconciliation.interval=24h")
@Import(PostgresFromCompose.class)
class ReservationReconciliationTest {

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
	void nothingHasBeenAbandonedYet() {
		this.rows = new Subscribers(this.db, IDP, "reconcile-suite-");
		this.calls = new Relists(this.port);
		this.rows.nobodyHasRelistedYet();
	}

	@AfterEach
	void stopReconciling() {
		this.reconciliations.shutdownNow();
	}

	/**
	 * The unit comes back. An MV3 worker is evicted between the delete and the create, a tab is closed, a
	 * machine sleeps — and the report that would have settled or refunded the unit never arrives, so without
	 * this the reservation holds it until the period rolls.
	 *
	 * <p>The refund is stamped with when it was decided rather than with when the grant ran out, which is the
	 * clock {@code usage_reservation_resolved_at_matches_status} wants a resolved row to carry and the only
	 * one that says how long we actually waited.
	 */
	@Test
	void aRelistNothingEverReportedOnGivesItsUnitBackOnceWeStopWaitingForOne() {
		Subscriber user = this.rows.entitledTo(3);
		UUID abandoned = abandoned(user, "ad-1");
		OffsetDateTime beforeTheJobRan = Subscribers.now();

		aReconciliation();

		Map<String, Object> handedBack = this.rows.reservation(abandoned);
		assertThat(handedBack.get("status")).isEqualTo("REFUNDED");
		assertThat(Subscribers.utc(handedBack, "resolved_at")).isBetween(beforeTheJobRan, Subscribers.now());
	}

	/**
	 * And the unit is one the gate hands out again, which is the whole point of the refund: a count that came
	 * back in the table but not in {@code /authorize} would be a user still locked out of a quota that says
	 * they have one left.
	 *
	 * <p>Asked of the endpoint rather than of {@code RemainingQuota}, because the reservation the second
	 * authorization takes is what proves the first one stopped being counted.
	 */
	@Test
	void andItIsAUnitTheGateWillHandOutAgain() {
		Subscriber user = this.rows.entitledTo(1);
		UUID theirOnlyUnit = authorize(user, "ad-1");
		assertThat(authorizing(user, "ad-2").statusCode()).isEqualTo(429);
		this.rows.grantRanOutAt(theirOnlyUnit, longEnoughAgoToGiveUpOn());

		aReconciliation();

		assertThat(authorizing(user, "ad-2").statusCode()).isEqualTo(200);
	}

	/**
	 * But a grant that ran out a minute ago is a relist that may still be running. The authorization is good
	 * for ~45 seconds and a relist is a capture, a photo download, a delete and a create with uploads — the
	 * grant expiring says the extension may no longer <em>start</em> one, not that it has stopped.
	 *
	 * <p>This is the whole reason there is a grace window rather than a sweep of everything expired.
	 */
	@Test
	void butAGrantThatRanOutAMomentAgoIsARelistThatMayStillBeRunning() {
		Subscriber user = this.rows.entitledTo(3);
		UUID inFlight = authorize(user, "ad-1");
		this.rows.grantRanOutAt(inFlight, Subscribers.now().minusMinutes(1));

		aReconciliation();

		assertThat(this.rows.reservation(inFlight).get("status")).isEqualTo("RESERVED");
	}

	/**
	 * Nothing is recorded about it. All three outcomes are things the extension observed on Marktplaats, and
	 * this job observed only that nobody said anything — a {@code relist_event} written here would put a
	 * guess into the breakage canary, where a rising {@code FAILED_BEFORE_DELETE} rate is supposed to mean
	 * Marktplaats moved something (#23, {@code docs/enforcement-contract.md}).
	 */
	@Test
	void andNothingIsRecordedAboutARelistNobodyReportedOn() {
		Subscriber user = this.rows.entitledTo(3);
		abandoned(user, "ad-1");

		aReconciliation();

		assertThat(this.rows.eventsOf(user)).isEmpty();
	}

	/**
	 * A reservation a report already settled is not one to hand back, however long ago its grant ran out. The
	 * ad was deleted, which is the half a user cannot undo, and a refund would let a relist loop that is
	 * failing after the delete burn a seller's listings for free.
	 *
	 * <p>The contract puts no deadline on reporting (#23), so a report arriving hours late is ordinary — and
	 * every reservation it settles is by then well past this job's window.
	 */
	@Test
	void aReservationAReportAlreadySettledIsNotOneToHandBack() {
		Subscriber user = this.rows.entitledTo(3);
		UUID reported = authorize(user, "ad-1");
		assertThat(complete(user, reported, "SUCCESS").statusCode()).isEqualTo(200);
		this.rows.grantRanOutAt(reported, longEnoughAgoToGiveUpOn());

		aReconciliation();

		assertThat(this.rows.reservation(reported).get("status")).isEqualTo("SETTLED");
	}

	/**
	 * And one this job has already handed back is not handed back twice. Idempotent because the predicate
	 * stops matching rather than because anything remembered the first run — which is also what makes two
	 * instances reconciling at once safe, since neither can know what the other did.
	 *
	 * <p>Asserted on {@code resolved_at} rather than on the status, which a second refund would leave exactly
	 * as it found it: the instant is the part that would move, and a refund whose stamp walks forward every
	 * few minutes is one no operator could read an abandonment rate from.
	 */
	@Test
	void andOneItHasAlreadyHandedBackIsNotHandedBackAgain() {
		Subscriber user = this.rows.entitledTo(3);
		UUID abandoned = abandoned(user, "ad-1");
		aReconciliation();
		OffsetDateTime whenItWasGivenBack = Subscribers.utc(this.rows.reservation(abandoned), "resolved_at");

		aReconciliation();
		aReconciliation();

		assertThat(this.rows.reservation(abandoned)).satisfies(row -> {
			assertThat(row.get("status")).isEqualTo("REFUNDED");
			assertThat(Subscribers.utc(row, "resolved_at")).isEqualTo(whenItWasGivenBack);
		});
	}

	/**
	 * A report that lands while the job is already scanning is still the one that stands — the case the ticket
	 * means by "safe to run concurrently", and the one no ordering of two calls can arrange.
	 *
	 * <p>Arranged rather than raced, the way both gate suites arrange theirs: the report is written on a
	 * connection of this suite's own and left uncommitted, so the reconciliation reads the row as it was
	 * — reserved, and long past its grant — matches it, and stops on the lock the report is holding. The
	 * commit then releases it into a row that no longer matches, and under {@code read committed} Postgres
	 * re-checks the predicate before writing rather than overwriting what it first saw. A statement that read
	 * the ids first and updated them afterwards would pass every other test here and fail this one, having
	 * refunded a relist that happened.
	 */
	@Test
	void aReportLandingWhileTheJobIsScanningIsStillTheOneThatStands() throws Exception {
		Subscriber user = this.rows.entitledTo(3);
		UUID contested = abandoned(user, "ad-1");
		OffsetDateTime whenTheReportLanded = Subscribers.now();
		try (Connection reporting = this.database.getConnection()) {
			reporting.setAutoCommit(false);
			this.rows.settledOn(reporting, contested, whenTheReportLanded);

			Future<?> reconciling = this.reconciliations.submit(this::aReconciliation);
			BlockedBackends.awaitAtLeast(1, this.db, Duration.ofSeconds(15));

			assertThat(reconciling.isDone()).isFalse();
			reporting.commit();
			reconciling.get(30, TimeUnit.SECONDS);
		}
		assertThat(this.rows.reservation(contested)).satisfies(stillSpent -> {
			assertThat(stillSpent.get("status")).isEqualTo("SETTLED");
			// Within a millisecond rather than to the nanosecond: Postgres keeps microseconds and the JVM
			// clock may offer more, so an exact comparison would be asserting how the driver rounds.
			assertThat(Subscribers.utc(stillSpent, "resolved_at")).isCloseTo(whenTheReportLanded,
					within(1, ChronoUnit.MILLIS));
		});
	}

	/**
	 * The job runs on a schedule of its own, which is the half of this ticket no arrangement above exercises:
	 * every test here invokes the task by hand, and a job nothing ever fired would pass all of them while
	 * never handing a unit back in production.
	 *
	 * <p>Asserting the registered task rather than the annotation is what makes it an end-to-end claim —
	 * {@code @EnableScheduling} is on the application, the method carries {@code @Scheduled}, and the delay is
	 * resolved from the property, since the value found here is the one this suite set rather than the one
	 * {@code application.yml} ships.
	 */
	@Test
	void andItIsScheduledWithTheIntervalItIsConfiguredWith() {
		assertThat(theScheduledReconciliation().getTask()).isInstanceOfSatisfying(FixedDelayTask.class,
				fixedDelay -> assertThat(fixedDelay.getIntervalDuration()).isEqualTo(Duration.ofHours(24)));
	}

	/**
	 * What the application ships, which is the copy the property above overrides and so the one no test here
	 * would otherwise be wrong about.
	 *
	 * <p>A range rather than the numbers themselves, because the numbers are a judgement an operator may
	 * revisit and the range is what the behaviour depends on. Both bounds are load-bearing: a grace shorter
	 * than a relist takes refunds units for relists that are still running, and one longer than a day is a
	 * free user's month a third short over a browser closed at the wrong moment. The two tests above that
	 * arrange "a moment ago" and "long enough ago" are written against exactly this range.
	 */
	@Test
	void theShippedGraceIsLongerThanAnyRelistAndShorterThanTheirPatience() {
		// Read through Boot's own parser, so what this asserts is the value the application binds rather than
		// a second reading of the same text.
		Duration grace = DurationStyle.detectAndParse(YamlSetting.inApplicationYaml("grace"));
		Duration interval = DurationStyle.detectAndParse(YamlSetting.inApplicationYaml("interval"));

		assertThat(grace).isGreaterThan(Duration.ofMinutes(1)).isLessThan(Duration.ofDays(1));
		// So that what a user waits for their unit is the grace, rather than a timer that dwarfs it.
		assertThat(interval).isLessThanOrEqualTo(grace);
	}

	/**
	 * And the sweep reads an index rather than the table. This job asks about every user at once, so V1's
	 * {@code usage_reservation_holding_a_unit} — which leads with {@code app_user_id} — cannot serve it, and
	 * without {@code usage_reservation_awaiting_a_report} (V3) the statement is a full scan taking row locks
	 * against the hot path, every few minutes, over a table that gains a row per relist and never loses one.
	 *
	 * <p>The plan is the subject rather than the index's existence, because the two come apart: the index is
	 * <em>partial</em> on {@code status = 'RESERVED'}, so it serves the statement only while the planner can
	 * prove that predicate holds. A statement that stopped carrying the status as a literal would return
	 * exactly the same rows and lose the index the moment it earned a generic plan, which is the failure
	 * {@code ReservationStatus#inSql} exists to rule out and the one nothing else here would notice.
	 *
	 * <p>Costs are not asserted, only that the index <em>can</em> serve the predicate — see {@link #planOf}.
	 */
	@Test
	void andItFindsThemThroughAnIndexRatherThanByReadingEveryRelistEverMade() throws SQLException {
		String plan = planOf("""
				update usage_reservation set status = 'REFUNDED', resolved_at = now()
				where status = 'RESERVED' and expires_at < now()
				""");

		assertThat(plan).contains("usage_reservation_awaiting_a_report");
	}

	/**
	 * How Postgres would reach those rows if reaching for an index were worth it.
	 *
	 * <p>Sequential scans are turned off for the question, because this table holds whatever one test just
	 * wrote and a planner is right to read a handful of rows directly — left on, this would assert the size of
	 * the fixture rather than anything about the schema. Off, the plan answers the question actually being
	 * asked: <em>is there an index that serves this predicate at all?</em> A partial index whose predicate the
	 * statement does not match is not chosen even then, since the planner cannot prove it holds every row the
	 * statement wants.
	 *
	 * <p>{@code set local} and a rollback, so the setting dies with this transaction rather than following the
	 * connection back into the pool and quietly planning somebody else's test. {@code explain} without
	 * {@code analyze} plans the statement and does not run it, so nothing here writes.
	 */
	private String planOf(String statement) throws SQLException {
		try (Connection planning = this.database.getConnection()) {
			planning.setAutoCommit(false);
			try (Statement session = planning.createStatement()) {
				session.execute("set local enable_seqscan = off");
				StringBuilder plan = new StringBuilder();
				try (ResultSet lines = session.executeQuery("explain " + statement)) {
					while (lines.next()) {
						plan.append(lines.getString(1)).append('\n');
					}
				}
				planning.rollback();
				return plan.toString();
			}
		}
	}

	// --- running the job --------------------------------------------------------------------------------

	/** One run of exactly what the scheduler runs, on this thread. */
	private void aReconciliation() {
		theScheduledReconciliation().getTask().getRunnable().run();
	}

	/**
	 * The one scheduled task this application has. Named by the method it runs rather than counted, so that a
	 * second scheduled job added later leaves this suite running the same one it always did — and so that a
	 * reconciliation which stopped being scheduled fails here rather than quietly never running.
	 */
	private ScheduledTask theScheduledReconciliation() {
		return this.scheduled.getScheduledTasks()
				.stream()
				.filter(task -> task.getTask().toString().contains("refundWhatNothingReportedOn"))
				.findFirst()
				.orElseThrow(() -> new AssertionError("Nothing scheduled runs the reconciliation; this application "
						+ "schedules " + this.scheduled.getScheduledTasks()));
	}

	// --- the calls --------------------------------------------------------------------------------------

	/**
	 * A unit taken and then given up on: authorized the way the extension does, with its grant moved back far
	 * enough that no plausible grace window still covers it.
	 */
	private UUID abandoned(Subscriber user, String adId) {
		UUID reservation = authorize(user, adId);
		this.rows.grantRanOutAt(reservation, longEnoughAgoToGiveUpOn());
		return reservation;
	}

	/**
	 * Far enough back that the shipped grace has certainly passed, without naming it: a day, which
	 * {@link #theShippedGraceIsLongerThanAnyRelistAndShorterThanTheirPatience()} is what keeps true.
	 */
	private static OffsetDateTime longEnoughAgoToGiveUpOn() {
		return Subscribers.now().minusDays(1);
	}

	private UUID authorize(Subscriber user, String adId) {
		return this.calls.authorized(user, adId);
	}

	private HttpResponse<String> authorizing(Subscriber user, String adId) {
		return this.calls.authorizing(user, adId);
	}

	private HttpResponse<String> complete(Subscriber user, UUID jti, String outcome) {
		return this.calls.completing(user, jti, outcome);
	}

	@Autowired
	private JdbcTemplate db;

	/** For the one test that holds a report open across a reconciliation. */
	@Autowired
	private DataSource database;

	/**
	 * The registered schedules, which exist only because {@code @EnableScheduling} is on the application —
	 * without it there is no such bean and this suite does not start.
	 */
	@Autowired
	private ScheduledTaskHolder scheduled;

	@LocalServerPort
	private int port;

	/** One thread, for the reconciliation that has to be running while this one holds a row. */
	private final ExecutorService reconciliations = Executors.newFixedThreadPool(1);

	/** The rows this suite arranges, under a tier prefix of its own — see {@link Subscribers}. */
	private Subscribers rows;

	/** The gate's own calls, over {@link #port} — see {@link Relists}. */
	private Relists calls;

}
