package com.mprelist.enforcement.internal;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * The relists nothing ever reported on, and the units they are still holding (#24).
 *
 * <p>{@code authorize} takes a unit before anything is deleted and {@code complete} settles or hands it back
 * (#23) — but nothing obliges the extension to arrive at the second call. An MV3 worker is evicted mid-relist,
 * a tab is closed, a machine sleeps, a network drops on the one request that mattered. Without this the unit
 * those took with them is held for the rest of the period, which on the free tier is a third of a month's
 * quota lost to a browser that was closed at the wrong moment.
 *
 * <p><strong>This is a guess, and it is the only guess in the enforcement path.</strong> A report is the sole
 * account of what actually happened on Marktplaats; what is known here is only that one has not arrived. So it
 * is deliberately the weaker claim of the two: a report that turns up afterwards <em>settles the unit back</em>
 * and this refund is discarded, which is the rule #23 fixed from its own side and
 * {@code RelistCompletionTest} holds. And no {@code relist_event} is written here — all three outcomes are
 * things the extension observed, and a row saying a relist failed because we stopped waiting for news of it
 * would put an invention into the breakage canary.
 *
 * <p>Nothing in {@link UsageReservations#refundAbandonedBefore} depends on this having run before, or on this
 * being the only thing running it: the statement is idempotent and its predicate is what keeps a resolution
 * that landed first from being overwritten.
 */
@Service
class ReservationReconciliation {

	/**
	 * @param grace how long past a grant running out a reservation is left alone. Configuration rather than a
	 * constant because it is a judgement about how slow a real relist gets, which is a thing the world tells
	 * us and not a thing this code knows — see {@code application.yml}, where the number and the reasoning for
	 * it are
	 */
	ReservationReconciliation(UsageReservations reservations,
			@Value("${mprelist.reconciliation.grace}") Duration grace) {
		this.reservations = reservations;
		this.grace = grace;
	}

	/**
	 * Stops waiting for the reports that are not coming, and gives back what they were holding.
	 *
	 * <p><strong>Both instants come from one read of the clock.</strong> The cutoff a reservation is judged
	 * abandoned against and the moment its refund is stamped with are then the same decision — two reads would
	 * make {@code resolved_at} sit a few milliseconds after a cutoff derived from a different one, and the
	 * interval between a grant expiring and its refund would stop being the grace window this is configured
	 * with.
	 *
	 * <p><strong>Scheduled on a fixed delay, so a run that is slow or blocked delays the next rather than
	 * overlapping it</strong> — and a run does block, briefly, on any row a report is resolving as it scans.
	 * A first run happens at startup, which is what reconciles whatever accumulated while nothing was running.
	 * No lock is taken across instances and none is wanted: two of them reconciling at once refund each row
	 * once between them, because the statement's predicate has stopped matching by the time the second arrives.
	 *
	 * <p>Logged only when it moved something. A count of nothing every few minutes is a line an operator learns
	 * to stop reading, and this number is worth reading: units handed back is the rate at which relists are
	 * being abandoned, which climbs for the same reasons {@link RelistEvents} exists to reveal.
	 */
	@Scheduled(fixedDelayString = "${mprelist.reconciliation.interval}")
	void refundWhatNothingReportedOn() {
		OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
		int handedBack = this.reservations.refundAbandonedBefore(now.minus(this.grace), now);
		if (handedBack > 0) {
			LOG.info("Gave back {} quota unit(s) held by relists that reported nothing within {} of their "
					+ "authorization running out", handedBack, this.grace);
		}
	}

	private static final Logger LOG = LoggerFactory.getLogger(ReservationReconciliation.class);

	private final UsageReservations reservations;

	private final Duration grace;

}
