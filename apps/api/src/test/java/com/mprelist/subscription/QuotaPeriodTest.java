package com.mprelist.subscription;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import org.junit.jupiter.api.Test;

/**
 * The month a window's usage is counted in (T87, ADR-0037): an annual price buys the monthly grant twelve
 * times, so a year Stripe bills is twelve quota periods, not one.
 *
 * <p>No database: this is arithmetic on two instants, and the months that break it — a 31st, a February — are
 * dates a suite run on any given day would never meet by itself.
 */
class QuotaPeriodTest {

	private static final OffsetDateTime BOUGHT_ON_A_31ST = OffsetDateTime.of(2026, 1, 31, 9, 15, 0, 0, ZoneOffset.UTC);

	private static final QuotaPeriod A_YEAR = new QuotaPeriod(BOUGHT_ON_A_31ST, BOUGHT_ON_A_31ST.plusYears(1));

	@Test
	void aYearIsCountedInTheMonthThatContainsNow() {
		OffsetDateTime inMarch = at(2026, 3, 10, 12);

		assertThat(A_YEAR.monthContaining(inMarch))
				.isEqualTo(new QuotaPeriod(at(2026, 2, 28, 9, 15), at(2026, 3, 31, 9, 15)));
	}

	/**
	 * Counted from the day it was bought and not from the month before, so February's clamp to the 28th does
	 * not become every later month's reset day.
	 */
	@Test
	void andEveryMonthIsCountedFromTheDayItWasBought() {
		assertThat(A_YEAR.monthContaining(at(2026, 8, 31, 12)).start()).isEqualTo(at(2026, 8, 31, 9, 15));
	}

	/**
	 * February the 28th after the anchor's time of day is March's window already, though a calendar says the
	 * two dates are less than a month apart — which is where {@code ChronoUnit.MONTHS.between} alone counts
	 * one month too few and answers a window that has closed.
	 */
	@Test
	void andTheDayAShortMonthEndsOnBelongsToTheNextOneFromTheAnchorsTimeOfDay() {
		assertThat(A_YEAR.monthContaining(at(2026, 2, 28, 8))).isEqualTo(
				new QuotaPeriod(BOUGHT_ON_A_31ST, at(2026, 2, 28, 9, 15)));
		assertThat(A_YEAR.monthContaining(at(2026, 2, 28, 10))).isEqualTo(
				new QuotaPeriod(at(2026, 2, 28, 9, 15), at(2026, 3, 31, 9, 15)));
	}

	/** The twelfth month ends exactly where Stripe's year does, so the grant resets with the renewal. */
	@Test
	void andTheTwelfthEndsWhereTheYearDoes() {
		assertThat(A_YEAR.monthContaining(at(2027, 1, 30, 12)))
				.isEqualTo(new QuotaPeriod(at(2026, 12, 31, 9, 15), A_YEAR.end()));
	}

	/**
	 * A window of about a month is one month, whatever its days: Stripe bills a monthly plan bought on the 31st
	 * from 28 February to 31 March, and cutting that at the 28th would hand out a second grant for three days.
	 */
	@Test
	void aMonthlyWindowIsOneMonthEvenWhenItIsLongerThanTheCalendarsMonth() {
		QuotaPeriod februaryToMarch = new QuotaPeriod(at(2026, 2, 28, 9, 15), at(2026, 3, 31, 9, 15));

		assertThat(februaryToMarch.monthContaining(at(2026, 3, 30, 12))).isEqualTo(februaryToMarch);
	}

	/**
	 * A window that has closed answers its own last month rather than inventing one past it: a payer's closed
	 * window means Stripe's webhook has not arrived yet, and the next period is Stripe's to say (#30).
	 */
	@Test
	void aClosedWindowAnswersItsLastMonthAndNothingPastIt() {
		assertThat(A_YEAR.monthContaining(at(2027, 3, 1, 12)))
				.isEqualTo(new QuotaPeriod(at(2026, 12, 31, 9, 15), A_YEAR.end()));
	}

	/** And a clock a moment behind the window's start answers its first month, not one before it. */
	@Test
	void aMomentBeforeTheWindowStartsIsItsFirstMonth() {
		assertThat(A_YEAR.monthContaining(BOUGHT_ON_A_31ST.minusSeconds(1)))
				.isEqualTo(new QuotaPeriod(BOUGHT_ON_A_31ST, at(2026, 2, 28, 9, 15)));
	}

	/**
	 * The free roll is the same arithmetic with no end (#20): a month from the anchor, the one that contains now,
	 * and never one that has already closed.
	 */
	@Test
	void theFreeRollIsTheMonthFromItsAnchorThatContainsNow() {
		assertThat(QuotaPeriod.monthFrom(BOUGHT_ON_A_31ST, at(2026, 2, 28, 10)))
				.isEqualTo(new QuotaPeriod(at(2026, 2, 28, 9, 15), at(2026, 3, 31, 9, 15)));
		assertThat(QuotaPeriod.monthFrom(BOUGHT_ON_A_31ST, at(2026, 5, 1, 0)))
				.isEqualTo(new QuotaPeriod(at(2026, 4, 30, 9, 15), at(2026, 5, 31, 9, 15)));
	}

	private static OffsetDateTime at(int year, int month, int day, int hour) {
		return at(year, month, day, hour, 0);
	}

	private static OffsetDateTime at(int year, int month, int day, int hour, int minute) {
		return OffsetDateTime.of(year, month, day, hour, minute, 0, 0, ZoneOffset.UTC);
	}

}
