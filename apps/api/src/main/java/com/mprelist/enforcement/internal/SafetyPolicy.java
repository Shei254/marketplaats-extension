package com.mprelist.enforcement.internal;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Optional;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.mprelist.identity.UserRef;

/**
 * The last check of the gate: whether this caller is going too fast (#25, ADR-0008,
 * {@code docs/enforcement-contract.md}).
 *
 * <p><strong>This rail is for the user's own account, not for ours.</strong> Relisting is delete-and-recreate
 * against a private API (ADR-0002/0004), and the account that gets flagged for a machine-shaped rhythm is the
 * seller's. So the number this refuses on favours account safety over bump frequency, which is ADR-0008's
 * stated posture rather than a throttle protecting our own capacity — nothing here is about load.
 *
 * <p><strong>It counts attempts, where quota counts what was kept.</strong> {@link Quotas} asks for the
 * reservations a period is still holding, so a relist that failed before anything was deleted gives its unit
 * back (#23) and one nothing ever reported on is handed back too (#24). This asks a different question and
 * gets a different answer: those relists <em>happened</em> as far as Marktplaats is concerned — an ad was
 * captured, photos were fetched, requests were made from the user's own session — and a rail that forgave
 * every failure would pace an extension that is failing not at all. The two reads therefore have no predicate
 * in common and neither is the other's filter.
 *
 * <p>The rules themselves are {@link RelistPace}, which holds all the arithmetic and none of the reading.
 * What is left here is the read and the configuration behind it.
 */
@Service
class SafetyPolicy {

	/**
	 * The rails, as configuration rather than constants, for the reason {@code ReservationReconciliation}'s
	 * grace is: how fast is too fast is a judgement about a platform that does not publish one, and the day a
	 * ban wave says the number was wrong is a day to change a setting rather than to ship a release. Neither
	 * is defaulted in code — a missing one fails startup instead of running with a rail nobody chose, which is
	 * the failure that would otherwise be invisible in the only direction that matters. See
	 * {@code application.yml}, where the numbers and the reasoning for them are.
	 */
	SafetyPolicy(UsageReservations reservations,
			@Value("${mprelist.safety.minimum-interval}") Duration minimumInterval,
			@Value("${mprelist.safety.burst-limit}") int burstLimit,
			@Value("${mprelist.safety.burst-window}") Duration burstWindow) {
		this.reservations = reservations;
		this.pace = new RelistPace(minimumInterval, burstLimit, burstWindow);
	}

	/**
	 * How long this caller has to wait, or nothing if they may relist now.
	 *
	 * <p>Bounded on both ends by {@link RelistPace} — back as far as the longer rail reaches, and never more
	 * rows than the burst cap — so the cost of this check does not grow with how much a user has ever relisted.
	 *
	 * <p><strong>Two of the same user's calls cannot both pass it</strong>, for the same reason two cannot both
	 * spend the last unit of a quota: the gate has already taken a write lock on this caller's subscription
	 * row, so the second call is still waiting at that read when the first commits its reservation, and reads
	 * it here. The rail needs no lock of its own and takes none.
	 *
	 * @param now read once by the caller and passed in, so that the horizon this counts back from and the
	 * expiry of the grant that follows it are the same moment rather than two readings of a clock
	 */
	Optional<Duration> waitRequiredOf(UserRef caller, OffsetDateTime now) {
		return this.pace.waitAfter(this.reservations.unitsTakenSince(caller, this.pace.readsBackTo(now),
				this.pace.relistsWorthReading()), now);
	}

	private final UsageReservations reservations;

	private final RelistPace pace;

}
