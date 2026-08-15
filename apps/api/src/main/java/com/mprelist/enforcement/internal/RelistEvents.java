package com.mprelist.enforcement.internal;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * The {@code relist_event} table: what the extension reported about a relist this backend authorized, one row
 * per reservation it resolved.
 *
 * <p>Refunds included, which is what makes this the <strong>breakage canary</strong> rather than the usage
 * count. We drive private, unversioned endpoints that ADR-0004 says will change without notice, and a rising
 * {@link RelistOutcome#FAILED_BEFORE_DELETE} rate is the first signal that Marktplaats moved something — the
 * trigger for a client-config hotfix (ADR-0013). A table that recorded only the relists that worked would be
 * blind to exactly the failure it exists to reveal. The count of what a period spent is
 * {@link UsageReservations}, one row away.
 *
 * <p>Which user and which ad are not repeated here: both are on the reservation this points at, through a
 * not-null foreign key, and a second copy is a second thing that can disagree.
 */
@Service
class RelistEvents {

	RelistEvents(JdbcClient db) {
		this.db = db;
	}

	/**
	 * Writes the report, unless this authorization has already been reported on.
	 *
	 * <p><strong>The database is what makes {@code /complete} idempotent</strong>, not a check this service
	 * runs first: {@code relist_event.reservation_id} is unique, so a second report for one authorization
	 * conflicts here rather than depending on anything having remembered the first. {@code do nothing} turns
	 * that conflict into an answer — the caller settles nothing further and replies with the quota as it
	 * stands, which is what the contract asks for and is also the right answer to the ordinary cause of a
	 * second report: an extension that retried because our own response never arrived.
	 *
	 * <p>It is the <em>first</em> report that decides, and the later ones cannot revise it. A
	 * {@code FAILED_BEFORE_DELETE} arriving after a {@code SUCCESS} does not hand the unit back for a relist
	 * that happened, which a last-writer-wins rule would — and under ADR-0007 the client sending it is the
	 * adversary.
	 *
	 * @param at when this was reported, passed rather than left to the column's {@code default now()} for the
	 * reason {@code UsageReservations.reserve} passes {@code reserved_at}: the row and the reservation it
	 * resolves should be stamped by one clock, or the interval between a relist being authorized and reported
	 * on — which is what #24 sizes its grace window from — is the drift between two machines
	 * @return whether this report is the one that counts, and so whether the reservation is this call's to
	 * resolve
	 */
	boolean recordFirstReportOf(UUID reservation, RelistOutcome outcome, OffsetDateTime at) {
		return this.db.sql("""
				insert into relist_event (reservation_id, outcome, recorded_at)
				values (?, ?, ?)
				on conflict (reservation_id) do nothing
				""")
				.params(reservation, outcome.name(), at)
				.update() == 1;
	}

	private final JdbcClient db;

}
