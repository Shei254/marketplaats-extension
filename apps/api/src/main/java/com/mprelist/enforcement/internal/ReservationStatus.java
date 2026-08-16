package com.mprelist.enforcement.internal;

/**
 * The three states of a {@code usage_reservation}, as the check constraint in {@code V1__baseline_schema.sql}
 * spells them: it holds its unit, it spent it, or it gave it back.
 *
 * <p>An enum here and a {@code text} column with a check constraint there, which is the pairing
 * {@link com.mprelist.subscription.SubscriptionStatus} already is and for a smaller version of its reason —
 * three constants that appear in SQL, in a report's mapping and in a test's arrangement should be spelled once.
 * The compiler is what then notices {@code "SETTLE"} where a column wants {@code "SETTLED"}, rather than the
 * constraint noticing it at the end of a relist somebody has already performed.
 *
 * <p>Package-private, like everything else in this module: the states of our own reservation table are nobody
 * else's business, and what {@code /complete} answers with is a quota rather than a status.
 */
enum ReservationStatus {

	/** Holding its unit, and the state every reservation is written in (#22). */
	RESERVED,

	/** The relist happened, so the unit stays spent for the rest of the period. */
	SETTLED,

	/** Nothing happened on Marktplaats, so the unit returned to the period. */
	REFUNDED;

	/**
	 * This state as a statement spells it: quoted, and pasted into the SQL rather than bound to it.
	 *
	 * <p><strong>Both indexes on {@code usage_reservation} are partial</strong> — {@code where status <>
	 * 'REFUNDED'} and {@code where status = 'RESERVED'} — and a planner uses one only when it can prove the
	 * statement's own predicate implies the index's. Through a bind parameter it can do that only while it is
	 * planning with the value substituted, which is a <em>custom</em> plan. The moment a repeatedly executed
	 * statement earns a <em>generic</em> one the parameter is opaque, the proof is unavailable, and the plan is
	 * a sequential scan: measured over 200k rows, cost 5356 against this index's 12.43.
	 *
	 * <p>Postgres only takes the generic plan when it judges it no worse, so a parameterized form would very
	 * likely keep the index today. That is the argument for the literal rather than against it — parameterized,
	 * the access path of a job that sweeps a growing table hangs on a cost comparison and a statement cache,
	 * and nothing announces the day it tips. The literal has no such day. It is the same reason the index's own
	 * predicate is written out in {@code V3__index_abandoned_reservations.sql}.
	 *
	 * <p>Safe to interpolate because the only values are this enum's own constants, named at the call site.
	 * Nothing a caller supplies reaches here.
	 *
	 * <p>A {@code set} clause takes a parameter as usual — see {@link UsageReservations#resolve} — since
	 * nothing is being matched there.
	 */
	String inSql() {
		return "'" + name() + "'";
	}

}
