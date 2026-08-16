package com.mprelist.enforcement.internal;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;

/**
 * How fast one account may relist: a minimum interval between two of them, and a cap on how many fit in a
 * window (ADR-0008, {@code docs/enforcement-contract.md}).
 *
 * <p><strong>Two rails, because one of them is not a cap on anything.</strong> The shipped interval is 30
 * seconds, which on its own permits a hundred and twenty relists an hour — the whole of a Power tier's month
 * in under two, at a rhythm no human has. The interval is what keeps consecutive actions from arriving in a
 * volley; the burst cap is what keeps a paced volley from running all day. Neither says what the other says,
 * so a configuration where one of them cannot bind is one where a rail was written off by arithmetic rather
 * than by decision, and {@code theShippedRailsAreBothOnesThatCanBind} is what says so out loud.
 *
 * <p><strong>Pure, and the reason it is a type rather than two fields on {@link SafetyPolicy}.</strong> Every
 * edge here is arithmetic over instants — which of two rails answers, what happens at the exact boundary, how
 * a wait is rounded — and each of those is a case a suite would otherwise have to reach through HTTP, a
 * Postgres and a clock it does not control. {@code RelistPaceTest} exercises the lot with no Spring context at
 * all, which is what {@link SafetyPolicy}'s own suite is then free not to re-assert. It is still
 * {@code internal}: ADR-0012 puts a decision in {@code enforcement/domain} when it acquires a <em>second
 * reader</em>, and a test is not one.
 *
 * @param minimumInterval how long after a relist before the next may be authorized. Zero turns the rail off,
 * which is a setting rather than an accident — the suites whose subject is quota arrange several relists in a
 * row, and that is exactly what this refuses
 * @param burstLimit how many may be authorized inside {@code burstWindow}. At least one, because a policy of
 * "none per window" is a gate nobody gets through and there is no wait that resolves it — refused where it is
 * configured rather than where it is applied
 * @param burstWindow the span the cap above counts in, sliding rather than aligned to a clock: a cap that
 * reset on the hour would let twice its number through across the boundary
 */
record RelistPace(Duration minimumInterval, int burstLimit, Duration burstWindow) {

	RelistPace {
		if (burstLimit < 1) {
			throw new IllegalArgumentException("A burst limit of " + burstLimit + " would refuse every relist "
					+ "with no wait that could resolve it; mprelist.safety.burst-limit must be at least 1");
		}
		if (minimumInterval.isNegative() || burstWindow.isNegative()) {
			throw new IllegalArgumentException("A negative pacing rail refuses nothing and would read as one "
					+ "that was set: mprelist.safety.minimum-interval was " + minimumInterval
					+ " and mprelist.safety.burst-window " + burstWindow);
		}
	}

	/**
	 * How far back a caller has to look to answer {@link #waitAfter}: as far as the longer of the two rails
	 * reaches, since a relist older than both can no longer bind either of them.
	 *
	 * <p>Asked here rather than computed by the reader, so that the bound on the statement and the arithmetic
	 * it feeds cannot come to disagree — a horizon shorter than a rail is a rail that silently stops applying,
	 * and nothing about the answer would look wrong.
	 */
	OffsetDateTime readsBackTo(OffsetDateTime now) {
		return now.minus(this.minimumInterval.compareTo(this.burstWindow) > 0 ? this.minimumInterval
				: this.burstWindow);
	}

	/**
	 * How many of them are worth reading: the {@code burstLimit}-th most recent is the oldest relist either
	 * rail can still be decided by, so an older one changes no answer this makes.
	 *
	 * <p>That is what keeps this off a table growing by a row per relist forever — the read is bounded by a
	 * number an operator configures rather than by how much a user has done.
	 */
	int relistsWorthReading() {
		return this.burstLimit;
	}

	/**
	 * How long before this caller may relist again, or nothing at all if they may now.
	 *
	 * <p><strong>The longer of the two rails answers</strong>, which is the whole of what makes them rails
	 * rather than suggestions: waiting out the one that binds today and being refused by the other is a
	 * cooldown timer that runs to zero in front of a user and then refuses them anyway.
	 *
	 * <p>The burst rail is decided by the {@code burstLimit}-th most recent relist and not by the oldest one
	 * in the window. They are the same row while the window holds exactly the cap, and they come apart the day
	 * an operator lowers the cap under somebody: what has to leave the window is enough of them to bring the
	 * count under the cap, and answering with the oldest would promise a moment at which this still refuses.
	 *
	 * <p><strong>Rounded up to whole seconds</strong>, because the number leaves here as a countdown a client
	 * renders. Rounded down, a client that waits exactly as long as it was told to arrives a fraction of a
	 * second early and is refused a second time — which reads to a user as a timer that lied, and to whoever
	 * fields the report as a rate limit that is broken.
	 *
	 * @param mostRecentFirst when this caller last took units, newest first, as far back as
	 * {@link #readsBackTo} and no more of them than {@link #relistsWorthReading}
	 */
	Optional<Duration> waitAfter(List<OffsetDateTime> mostRecentFirst, OffsetDateTime now) {
		OffsetDateTime free = now;
		if (!mostRecentFirst.isEmpty()) {
			free = later(free, mostRecentFirst.get(0).plus(this.minimumInterval));
		}
		if (mostRecentFirst.size() >= this.burstLimit) {
			free = later(free, mostRecentFirst.get(this.burstLimit - 1).plus(this.burstWindow));
		}
		return free.isAfter(now) ? Optional.of(wholeSeconds(Duration.between(now, free))) : Optional.empty();
	}

	private static OffsetDateTime later(OffsetDateTime one, OffsetDateTime other) {
		return one.isAfter(other) ? one : other;
	}

	/** Up, never down — see {@link #waitAfter}. Only ever asked of a positive duration. */
	private static Duration wholeSeconds(Duration wait) {
		Duration whole = wait.truncatedTo(ChronoUnit.SECONDS);
		return whole.equals(wait) ? whole : whole.plusSeconds(1);
	}

}
