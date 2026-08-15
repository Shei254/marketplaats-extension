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
	 * Whether this is a state a reservation stops moving from — which both of the two below are, since the
	 * report that resolves one is also the last word on it.
	 *
	 * <p>Restates the {@code usage_reservation_resolved_at_matches_status} half that says a resolved row
	 * carries the instant it was resolved at: putting a reservation <em>back</em> to {@link #RESERVED} with a
	 * {@code resolved_at} is a row the constraint would refuse, and it should be refused before a relist that
	 * has already happened is rolled back by a failing statement.
	 */
	boolean isTerminal() {
		return this != RESERVED;
	}

}
