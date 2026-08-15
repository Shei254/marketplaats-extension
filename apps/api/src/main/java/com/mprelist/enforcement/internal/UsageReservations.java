package com.mprelist.enforcement.internal;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import com.mprelist.identity.UserRef;

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
	 * <p>Half-open, {@code [from, until)}, which is the interval every other statement about a quota period in
	 * this repository uses. A reservation written at the exact instant a window rolls belongs to the new one.
	 *
	 * @param from the period start, inclusive
	 * @param until the period end, exclusive
	 */
	int unitsHeldIn(UserRef user, OffsetDateTime from, OffsetDateTime until) {
		return this.db.sql("""
				select count(*) from usage_reservation
				where app_user_id = ? and status <> 'REFUNDED' and reserved_at >= ? and reserved_at < ?
				""")
				.params(user.id(), from, until)
				.query(Integer.class)
				.single();
	}

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
	UUID reserve(UserRef user, String adId, OffsetDateTime at, OffsetDateTime expiresAt) {
		return this.db.sql("""
				insert into usage_reservation (app_user_id, ad_id, reserved_at, expires_at)
				values (?, ?, ?, ?)
				returning id
				""")
				.params(user.id(), adId, at, expiresAt)
				.query(UUID.class)
				.single();
	}

	private final JdbcClient db;

}
