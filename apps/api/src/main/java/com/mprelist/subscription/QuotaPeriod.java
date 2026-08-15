package com.mprelist.subscription;

import java.time.OffsetDateTime;

/**
 * The window a subscription's usage is counted in — {@code docs/glossary.md}'s "quota period", which every
 * other statement in this repository writes as {@code [periodStart, periodEnd)}.
 *
 * <p>One type rather than two parameters, because the two never travel apart: they are read together, written
 * together, rolled together, and passed together to the count that decides whether a relist is refused. Two
 * {@code OffsetDateTime}s in a row is also a pair the compiler cannot tell apart, and a window handed over
 * backwards counts usage in an empty interval — which reads as a quota nobody has spent rather than as a
 * fault. That is the invariant below, stated once here instead of at each place a pair is assembled.
 *
 * @param start the start of the window, inclusive
 * @param end the end of it, exclusive, and so the {@code resetAt} every quota denial and {@code GET /api/me}
 * carries
 */
public record QuotaPeriod(OffsetDateTime start, OffsetDateTime end) {

	/**
	 * The {@code subscription_period_runs_forward} check of {@code V1__baseline_schema.sql}, restated where a
	 * period is built rather than only where a row is written — for {@link com.mprelist.catalog.Entitlement}'s
	 * reason: #22's tests stand these up with no database behind them.
	 */
	public QuotaPeriod {
		if (start == null || end == null) {
			throw new IllegalArgumentException("A quota period is the window usage is counted in, so both of "
					+ "its bounds have to be answerable rather than only a payer's");
		}
		if (!end.isAfter(start)) {
			throw new IllegalArgumentException("A quota period that does not run forward is one no usage can "
					+ "fall inside: " + start + " to " + end);
		}
	}

	/**
	 * Whether this window has closed by the given instant. Half-open, so a window whose {@code end} is exactly
	 * {@code instant} has closed: the reservation written at that instant belongs to the next one.
	 *
	 * <p>Named rather than left as {@code !period.end().isAfter(now)} at the one place that asks, because a
	 * negated comparison on an exclusive bound is where an off-by-one hides, and the half-open convention is
	 * the thing being asserted.
	 */
	public boolean hasClosedBy(OffsetDateTime instant) {
		return !this.end.isAfter(instant);
	}

}
