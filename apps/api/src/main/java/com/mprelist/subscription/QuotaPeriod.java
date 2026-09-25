package com.mprelist.subscription;

import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;

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

	/**
	 * The month of this window that contains {@code now} — what usage is counted in when the window is a Stripe
	 * billing period (T87, ADR-0037). An annual price buys the monthly grant twelve times, so a year is twelve of
	 * these; a window of about a month is exactly one.
	 *
	 * <p>Months are counted from this window's start, and the last one ends at its end, so the twelfth closes
	 * when Stripe renews. A remainder shorter than a month is folded into the last month rather than made a
	 * month of its own: Stripe bills a plan bought on the 31st from 28 February to 31 March, and a three-day
	 * sliver there would be a second grant nobody paid for.
	 *
	 * <p>A {@code now} outside the window answers the nearest month inside it, never one past it. A closed payer's
	 * window means Stripe's webhook has not arrived, and the next period is Stripe's to say (#30).
	 */
	public QuotaPeriod monthContaining(OffsetDateTime now) {
		long months = Math.max(1, wholeMonthsBetween(this.start, this.end));
		long month = Math.min(Math.max(0, wholeMonthsBetween(this.start, now)), months - 1);
		OffsetDateTime end = month == months - 1 ? this.end : this.start.plusMonths(month + 1);
		return new QuotaPeriod(this.start.plusMonths(month), end);
	}

	/**
	 * The month counted from {@code anchor} that contains {@code now}, with no end to stop at — the free roll's
	 * window (#20), anchored on the subscription's creation.
	 */
	public static QuotaPeriod monthFrom(OffsetDateTime anchor, OffsetDateTime now) {
		long month = wholeMonthsBetween(anchor, now);
		return new QuotaPeriod(anchor.plusMonths(month), anchor.plusMonths(month + 1));
	}

	/**
	 * How many whole months from {@code anchor} have passed by {@code instant}, where a month from the anchor
	 * is {@code anchor.plusMonths(n)}.
	 *
	 * <p>Not {@code ChronoUnit.MONTHS.between} alone, which disagrees with {@code plusMonths} at the clamp: from
	 * 31 January 09:15 it counts 28 February 10:00 as no months at all, though {@code plusMonths(1)} — 28
	 * February 09:15 — has passed. Answering that would be a window already closed when it is handed out, and a
	 * reservation stamped now would fall outside it.
	 */
	private static long wholeMonthsBetween(OffsetDateTime anchor, OffsetDateTime instant) {
		long months = ChronoUnit.MONTHS.between(anchor, instant);
		return anchor.plusMonths(months + 1).isAfter(instant) ? months : months + 1;
	}

}
