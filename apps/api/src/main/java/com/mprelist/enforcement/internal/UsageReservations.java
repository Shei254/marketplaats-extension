package com.mprelist.enforcement.internal;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import com.mprelist.identity.UserRef;
import com.mprelist.subscription.QuotaPeriod;

/**
 * The {@code usage_reservation} table: the quota unit itself, from the moment {@code authorize} hands one out
 * until {@code complete} settles or refunds it (#23) or #24 reconciles an abandoned one.
 *
 * <p>The unit lives on a row of its own rather than as a counter on the subscription, which is what makes an
 * in-flight relist cost quota while it is in flight: the extension is between the delete and the create and has
 * reported nothing, and a counter incremented on the way out would have nowhere to hold that.
 */
@Service
class UsageReservations {

	UsageReservations(JdbcClient db) {
		this.db = db;
	}

	/**
	 * Usage in a window: the reservations inside it that still hold their unit.
	 *
	 * <p>{@code status <> 'REFUNDED'} rather than {@code = 'RESERVED'}, because a settled reservation has spent
	 * its unit and a refunded one has given it back — those are the two terminal states, and counting only the
	 * open ones would refund every relist the moment it was reported. It is also the index's own predicate
	 * ({@code usage_reservation_holding_a_unit}), so this is the read that index exists for.
	 *
	 * <p>Half-open, {@code [start, end)}, which is {@link QuotaPeriod}'s own convention and the interval every
	 * other statement about a quota period in this repository uses. A reservation written at the exact instant
	 * a window rolls belongs to the new one.
	 *
	 * @param period the window to count in, taken whole rather than as two bounds a caller could hand over the
	 * wrong way round
	 */
	int unitsHeldIn(UserRef user, QuotaPeriod period) {
		return this.db.sql(UNITS_HELD_IN)
				.params(user.id(), period.start(), period.end())
				.query(Integer.class)
				.single();
	}

	private static final String UNITS_HELD_IN = """
			select count(*) from usage_reservation
			where app_user_id = ? and status <> %s and reserved_at >= ? and reserved_at < ?
			""".formatted(ReservationStatus.REFUNDED.inSql());

	/**
	 * Takes one unit, and answers with the id that is the authorization's {@code jti}.
	 *
	 * <p>{@code reserved_at} is passed rather than left to the column's default, so that the instant this row is
	 * counted at is the one the gate has already compared against the period it counted in. Two clocks — the
	 * application's and the database's — differ by however far apart the machines are, and the row that falls
	 * outside the window it was authorized against is one nobody would find.
	 *
	 * @param expiresAt the authorization's own expiry, which #24 reads to find reservations nothing ever
	 * reported on
	 */
	UUID reserve(UserRef user, AdId adId, OffsetDateTime at, OffsetDateTime expiresAt) {
		return this.db.sql("""
				insert into usage_reservation (app_user_id, ad_id, reserved_at, expires_at)
				values (?, ?, ?, ?)
				returning id
				""")
				.params(user.id(), adId.value(), at, expiresAt)
				.query(UUID.class)
				.single();
	}

	/**
	 * Whether that reservation is this caller's to resolve — asked by {@code /complete} before it acts on a
	 * {@code jti} a client sent (#23).
	 *
	 * <p>Both halves in one question rather than a lookup and a comparison, because the pair is the whole of
	 * what is being asked: an id that is not there and one that is somebody else's are the same answer to this
	 * caller, and reading the row first would leave the second check to a caller who could forget it.
	 *
	 * <p>Says nothing about whether the unit is still held. A reservation already settled, refunded or expired
	 * is still the caller's, and what happens to a second report about one is the {@code relist_event} unique's
	 * to decide rather than this predicate's.
	 */
	boolean belongsTo(UUID reservation, UserRef user) {
		return this.db.sql("select count(*) from usage_reservation where id = ? and app_user_id = ?")
				.params(reservation, user.id())
				.query(Integer.class)
				.single() == 1;
	}

	/**
	 * Moves a reservation to the state its report resolved it into: the unit spent, or handed back.
	 *
	 * <p>{@code resolved_at} is passed rather than left to a default for {@link #reserve}'s reason, and it is
	 * the same instant the {@code relist_event} beside it carries — the row and the report about it are stamped
	 * by one clock.
	 *
	 * <p>Unconditional on the current status, and deliberately: at-most-once is the {@code relist_event}
	 * unique's job (#23), so a second guard here would be a second thing that could disagree with it. What
	 * that means for a reservation #24 has already refunded for want of a report is that a report finally
	 * arriving still wins — it is the only account of what happened on Marktplaats, and reconciliation is the
	 * guess made in its absence.
	 *
	 * @param into where it lands, which is always terminal because {@link RelistOutcome#resolvesTo()} is where
	 * that is decided and it names only the two: a resolved row carries the instant it resolved at
	 * ({@code usage_reservation_resolved_at_matches_status}), so putting one back to
	 * {@link ReservationStatus#RESERVED} is a row the database would refuse anyway. No guard here for it — a
	 * fourth outcome has to answer the question where the mapping is declared, and a check that no caller can
	 * fail is one no test can hold to its message
	 */
	void resolve(UUID reservation, ReservationStatus into, OffsetDateTime at) {
		this.db.sql("update usage_reservation set status = ?, resolved_at = ? where id = ?")
				.params(into.name(), at, reservation)
				.update();
	}

	/**
	 * Hands back every unit still held by a grant that ran out before {@code cutoff} — the relists nothing ever
	 * reported on, which {@link ReservationReconciliation} is what decides to stop waiting for.
	 *
	 * <p><strong>{@code status = 'RESERVED'} is the whole of the safety, and it is the database that enforces
	 * it.</strong> A reservation {@code /complete} has already resolved is not {@code RESERVED} any more and so
	 * is not matched — and under {@code read committed} a row settled by a report <em>while this statement is
	 * scanning</em> is re-checked before it is written: the update blocks on that row's lock, and when the
	 * report commits it finds the predicate no longer holds and leaves the row alone. So a report that landed
	 * first is never overwritten by a guess made in its absence, which is the rule #23 fixed from its own side.
	 *
	 * <p>That is also what makes this idempotent and safe to run twice over, whether the second run is the next
	 * tick or a second instance: the rows the first one moved are {@code REFUNDED}, and the predicate has
	 * stopped matching them. Nothing is remembered between runs, so there is nothing that could disagree with
	 * the rows.
	 *
	 * <p>One statement, and so one transaction of its own — there is nothing here to make atomic with anything
	 * else. It takes no lock on the subscription, unlike both ends of the gate: this changes what a period
	 * holds without reading a plan, so it never waits on the hot path and cannot deadlock against a call that
	 * takes the subscription first and this row second.
	 *
	 * <p>The predicate is {@code usage_reservation_awaiting_a_report}'s own (V3), which is what keeps a sweep
	 * running every few minutes off a table that grows by a row per relist and never shrinks. That index is
	 * partial on the same {@code RESERVED}, so what it holds is only ever the relists currently in flight —
	 * and a row leaves it the moment either this job or a report resolves it.
	 *
	 * @param cutoff the instant a grant must have run out before, which is now less the grace window. Judged on
	 * {@code expires_at} rather than on {@code reserved_at}, so that what a relist is measured against is the
	 * authorization it was actually given ({@link RelistAuthorizations#LIFETIME}) rather than a second rule
	 * that could drift from it
	 * @param at when this refund was decided, stamped on every row it moves for {@link #resolve}'s reason and
	 * taken from the same clock as {@code cutoff} — an interval measured between two clocks is the drift
	 * between two machines
	 * @return how many units went back, which is the abandonment rate an operator has to read this from
	 */
	int refundAbandonedBefore(OffsetDateTime cutoff, OffsetDateTime at) {
		return this.db.sql(REFUND_ABANDONED)
				.params(ReservationStatus.REFUNDED.name(), at, cutoff)
				.update();
	}

	/**
	 * The matched status is pasted in and the written one is bound, which is {@link ReservationStatus#inSql}'s
	 * distinction: {@code usage_reservation_awaiting_a_report} is partial on the predicate below, so what the
	 * planner can prove about that value decides whether this reads an index or the whole table. Nothing is
	 * proved about the value in a {@code set} clause, and nothing needs to be.
	 */
	private static final String REFUND_ABANDONED = """
			update usage_reservation set status = ?, resolved_at = ?
			where status = %s and expires_at < ?
			""".formatted(ReservationStatus.RESERVED.inSql());

	private final JdbcClient db;

}
