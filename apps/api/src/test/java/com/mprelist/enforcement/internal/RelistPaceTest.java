package com.mprelist.enforcement.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * The pacing rails themselves: which of the two answers, what happens at the exact instant one runs out, and
 * how a wait is rounded (#25, ADR-0008).
 *
 * <p><strong>No Spring and no database, which is what the type is for.</strong> Every claim below is
 * arithmetic over instants, and reaching it through {@code /api/relist/authorize} would mean arranging rows
 * against a clock this suite does not control — a boundary case like "the interval ran out this very
 * millisecond" is not a thing an HTTP call can be made to land on. {@link RelistPacingTest} is then free to be
 * about the wiring rather than about the edges: that the gate refuses on this, reads the rows it should, and
 * says so in the shape the contract fixes.
 *
 * <p>{@code NOW} is a literal rather than a reading of the system clock, so that every duration here is one a
 * reader can check by subtracting two numbers on the page.
 */
class RelistPaceTest {

	private static final OffsetDateTime NOW = OffsetDateTime.of(2026, 8, 16, 12, 0, 0, 0, ZoneOffset.UTC);

	/** Thirty seconds apart, three in an hour — the shipped shape, with numbers small enough to read. */
	private static final RelistPace PACE = new RelistPace(Duration.ofSeconds(30), 3, Duration.ofHours(1));

	@Test
	void aCallerWhoHasNotRelistedAtAllMayRelistNow() {
		assertThat(PACE.waitAfter(List.of(), NOW)).isEmpty();
	}

	@Test
	void andSoMayOneWhoseLastRelistIsFurtherBackThanTheInterval() {
		assertThat(PACE.waitAfter(List.of(secondsAgo(31)), NOW)).isEmpty();
	}

	/** Inside it, the wait is what is left of the interval and not the interval itself. */
	@Test
	void aRelistInsideTheIntervalWaitsOutWhatIsLeftOfIt() {
		assertThat(PACE.waitAfter(List.of(secondsAgo(10)), NOW)).contains(Duration.ofSeconds(20));
	}

	/**
	 * And the interval is over at the instant it runs out rather than after it. A rail that refused on its own
	 * boundary would answer a client that waited exactly as long as it was told with a second refusal, which
	 * reads as a timer that lied.
	 */
	@Test
	void andItIsOverAtTheInstantItRunsOutRatherThanAfterIt() {
		assertThat(PACE.waitAfter(List.of(secondsAgo(30)), NOW)).isEmpty();
	}

	/**
	 * A wait is rounded <strong>up</strong> to whole seconds, because it leaves here as a countdown a client
	 * renders. Rounded down, a client that waits exactly as long as it was told arrives a fraction of a second
	 * early and is refused again — the same lie, from the other end.
	 */
	@Test
	void aWaitIsRoundedUpToWholeSeconds() {
		assertThat(PACE.waitAfter(List.of(NOW.minus(Duration.ofMillis(9_500))), NOW))
				.contains(Duration.ofSeconds(21));
	}

	/** And one that is already whole is left where it is, rather than rounded past the moment it is over. */
	@Test
	void andOneThatIsAlreadyWholeIsLeftAlone() {
		assertThat(PACE.waitAfter(List.of(secondsAgo(9)), NOW)).contains(Duration.ofSeconds(21));
	}

	/**
	 * The burst cap refuses a volley every one of which was far enough from the last — which is the whole
	 * reason there are two rails. Thirty seconds apart is a hundred and twenty relists an hour, at a rhythm no
	 * human has, and the interval on its own has nothing to say about it.
	 *
	 * <p>The wait is until the relist that filled the window leaves it, so it is measured from that row rather
	 * than from the most recent one.
	 */
	@Test
	void aWindowFullOfRelistsIsRefusedThoughEveryOneOfThemWasFarEnoughFromTheLast() {
		List<OffsetDateTime> aVolley = List.of(minutesAgo(30), minutesAgo(31), minutesAgo(32));

		assertThat(PACE.waitAfter(aVolley, NOW)).contains(Duration.ofMinutes(28));
	}

	/** One short of the cap is not a cap: the window has room, so only the interval has anything to say. */
	@Test
	void andOneShortOfTheCapIsNotACap() {
		assertThat(PACE.waitAfter(List.of(minutesAgo(30), minutesAgo(31)), NOW)).isEmpty();
	}

	/**
	 * When both rails bind, the longer of the two answers. Waiting out the one that binds today and being
	 * refused by the other is a cooldown that runs to zero in front of a user and then refuses them anyway.
	 */
	@Test
	void theLongerOfTheTwoRailsIsTheOneAnswered() {
		List<OffsetDateTime> aFullWindowAndOneJustNow = List.of(secondsAgo(1), minutesAgo(31), minutesAgo(32));

		assertThat(PACE.waitAfter(aFullWindowAndOneJustNow, NOW)).contains(Duration.ofMinutes(28));
	}

	/** Which is the interval, on the day a window is nearly through and the last relist was a moment ago. */
	@Test
	void andThatIsTheIntervalWhenTheWindowIsAlmostClear() {
		List<OffsetDateTime> aWindowAboutToOpen = List.of(NOW, secondsAgo(5), secondsAgo(3_590));

		assertThat(PACE.waitAfter(aWindowAboutToOpen, NOW)).contains(Duration.ofSeconds(30));
	}

	/**
	 * The burst rail is decided by the cap-th most recent relist and not by the oldest one in the window. They
	 * are the same row while the window holds exactly the cap, and they come apart the day an operator lowers
	 * the cap under somebody who has already relisted more than it: what has to leave the window is enough of
	 * them to bring the count <em>under</em> the cap, and answering from the oldest would promise a moment at
	 * which this still refuses.
	 */
	@Test
	void theBurstRailIsDecidedByTheCapthMostRecentRelistRatherThanByTheOldestInTheWindow() {
		RelistPace loweredUnderThem = new RelistPace(Duration.ofSeconds(30), 2, Duration.ofHours(1));
		List<OffsetDateTime> fourInTheWindow = List.of(minutesAgo(10), minutesAgo(20), minutesAgo(30),
				minutesAgo(40));

		assertThat(loweredUnderThem.waitAfter(fourInTheWindow, NOW)).contains(Duration.ofMinutes(40));
	}

	/**
	 * Rails set to nothing refuse nothing, which is a setting rather than an accident: the suites whose subject
	 * is quota arrange several relists in a row, and that is exactly what pacing exists to refuse.
	 */
	@Test
	void railsSetToNothingRefuseNothing() {
		RelistPace off = new RelistPace(Duration.ZERO, 1, Duration.ZERO);

		assertThat(off.waitAfter(List.of(NOW), NOW)).isEmpty();
	}

	/**
	 * How far back a caller has to read is the longer of the two rails, in either order — a relist older than
	 * both can no longer bind either, and a horizon shorter than a rail is a rail that silently stops applying.
	 */
	@Test
	void theHorizonIsAsFarBackAsTheLongerRailReaches() {
		assertThat(PACE.readsBackTo(NOW)).isEqualTo(NOW.minusHours(1));
		assertThat(new RelistPace(Duration.ofHours(2), 3, Duration.ofHours(1)).readsBackTo(NOW))
				.isEqualTo(NOW.minusHours(2));
	}

	/**
	 * And no more rows than the cap, since the cap-th most recent is the oldest relist either rail can be
	 * decided by. That is what keeps this read off a table growing by a row per relist forever: it is bounded
	 * by a number an operator configures rather than by how much a user has done.
	 */
	@Test
	void andNoMoreRelistsThanTheCapCanBeDecidedBy() {
		assertThat(PACE.relistsWorthReading()).isEqualTo(3);
	}

	/**
	 * A cap of none is a gate nobody gets through and no wait resolves, so it is refused where it is
	 * configured rather than where it is applied — at startup, by the operator who typed it, rather than
	 * silently at every relist.
	 */
	@Test
	void aBurstCapOfNoneIsRefusedWhereItIsConfigured() {
		assertThatThrownBy(() -> new RelistPace(Duration.ofSeconds(30), 0, Duration.ofHours(1)))
				.isInstanceOf(IllegalArgumentException.class);
	}

	/** And so is a rail set to less than nothing, which refuses nothing while reading as one that was set. */
	@Test
	void andSoIsARailSetToLessThanNothing() {
		assertThatThrownBy(() -> new RelistPace(Duration.ofSeconds(-1), 3, Duration.ofHours(1)))
				.isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> new RelistPace(Duration.ofSeconds(30), 3, Duration.ofHours(-1)))
				.isInstanceOf(IllegalArgumentException.class);
	}

	private static OffsetDateTime secondsAgo(long seconds) {
		return NOW.minusSeconds(seconds);
	}

	private static OffsetDateTime minutesAgo(long minutes) {
		return NOW.minusMinutes(minutes);
	}

}
