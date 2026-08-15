package com.mprelist.enforcement.internal;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.mprelist.identity.UserRef;
import com.mprelist.subscription.Subscription;
import com.mprelist.subscription.Subscriptions;

/**
 * The other end of the gate: what the extension says happened to a relist it was authorized for, and what
 * that costs (ADR-0007, {@code docs/enforcement-contract.md}).
 *
 * <p>Every authorization takes a unit before anything is deleted, so <strong>every one of them has to come
 * back here</strong> or the unit stays taken for the rest of the period. That is the accounting half. The
 * other half is telemetry and is the reason this endpoint would exist even if quota were free: the outcome mix
 * is how we learn that Marktplaats moved something, before the support tickets do.
 *
 * <p><strong>No check runs here.</strong> A lapsed payer whose subscription stopped between the authorize and
 * the report is still the only witness to what happened on Marktplaats, and refusing their report would hold
 * their unit forever and lose exactly the outcome the canary is watching for. The same goes for a report that
 * arrives after the 45-second grant expired: the token's lifetime bounds how long an <em>authorization</em> is
 * good for, not how long the extension has to say what it did with one. This call spends nothing and grants
 * nothing, so there is nothing here to fail closed about.
 */
@Service
class RelistReports {

	RelistReports(Subscriptions subscriptions, Quotas quotas, UsageReservations reservations,
			RelistEvents events) {
		this.subscriptions = subscriptions;
		this.quotas = quotas;
		this.reservations = reservations;
		this.events = events;
	}

	/**
	 * Records the report and resolves the reservation it names, answering with the quota as it then stands —
	 * so a relist needs no follow-up {@code /api/me} call to know what it has left.
	 *
	 * <p><strong>The reservation has to be the caller's own, and that is asked first.</strong> Otherwise a
	 * {@code jti} guessed or observed elsewhere would let one account resolve another's: settling costs the
	 * owner nothing extra, but refunding hands them quota they did not earn, and either way it writes a
	 * {@code relist_event} that misreports what Marktplaats did to whoever is reading the canary. Asked before
	 * the subscription is read because reading one is not free of consequence — {@code currentFor} takes a
	 * write lock and may roll a closed window — and a {@code jti} that is nobody's is the one input to this
	 * call an adversary chooses (ADR-0007). The row's owner does not change, so nothing is gained by asking
	 * under the lock.
	 *
	 * <p><strong>Transactional, and the subscription is read before the report is written.</strong>
	 * {@code Subscriptions.currentFor} locks the caller's row for the length of this call, which puts this
	 * report and any other call of theirs in a line rather than letting the number answered here be one from
	 * the middle of another. It is also what rolls a free window that has closed since the authorization was
	 * issued — a relist begun in one period and reported in the next is counted, and given a {@code resetAt},
	 * in the one that is current now.
	 *
	 * @return the quota left in the current period, or empty when the {@code jti} names no reservation of this
	 * caller's. An {@link Optional} rather than the exception {@code TierCatalog} and {@code Subscriptions}
	 * throw, because the two situations are opposites: those report an invariant this application maintains
	 * having been broken, and this reports a value a client sent being wrong — an ordinary answer, which the
	 * route has a status for
	 */
	@Transactional
	Optional<RemainingQuota> record(UserRef caller, CompleteRequest report) {
		if (!this.reservations.belongsTo(report.jti(), caller)) {
			return Optional.empty();
		}
		Subscription plan = this.subscriptions.currentFor(caller);
		OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
		if (this.events.recordFirstReportOf(report.jti(), report.outcome(), now)) {
			// Only on the first report. A second one is a retry of a call whose answer never arrived, and the
			// unit it would move has already been moved by the report that counts.
			this.reservations.resolve(report.jti(), report.outcome().resolvesTo(), now);
		}
		return Optional.of(this.quotas.leftFor(caller, plan));
	}

	private final Subscriptions subscriptions;

	private final Quotas quotas;

	private final UsageReservations reservations;

	private final RelistEvents events;

}
