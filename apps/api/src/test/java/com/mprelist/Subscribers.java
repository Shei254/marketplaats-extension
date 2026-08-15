package com.mprelist;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The rows the gate reads, arranged directly: a tier granting a chosen number of relists, an account on it,
 * and whatever has already been spent against the window.
 *
 * <p>Arranging them as data is the seam {@code docs/specs/quota-enforcement.md} asks for, and it is the only
 * way to reach a state no sequence of calls to this API can produce — a lapsed payer, a window that closed
 * three months ago, a reservation a reconciliation job already refunded.
 *
 * <p>One home for it, because two suites now need the same rows: {@link RelistAuthorizationTest} arranges what
 * a relist is authorized against and {@link RelistCompletionTest} arranges what a report resolves. The SQL
 * being in one place is what keeps a schema change from being fixed in the suite somebody remembered — and
 * these statements write columns (a subscription's {@code created_at}, a reservation's {@code expires_at})
 * whose meaning the tests then assert, so a copy that drifted would be a suite quietly testing a different
 * arrangement than it says it does.
 *
 * <p>Each suite brings its own prefix, so that {@link #nobodyHasRelistedYet()} drops the tiers that suite
 * arranged and leaves the seeded catalog — which {@code TierCatalogSeedTest} asserts and this must not touch —
 * exactly as it found it.
 */
final class Subscribers {

	Subscribers(JdbcTemplate db, MintedTokens idp, String tierCodePrefix) {
		this.db = db;
		this.idp = idp;
		this.tierCodePrefix = tierCodePrefix;
	}

	/** Accounts first, which takes their subscriptions, reservations and events with it, then the tiers. */
	void nobodyHasRelistedYet() {
		this.db.update("delete from app_user");
		this.db.update("delete from tier where code like ?", this.tierCodePrefix + "%");
	}

	// --- arrangement ------------------------------------------------------------------------------------

	/**
	 * An account on a tier of this suite's own, {@code active}, with a window that is open now — the ordinary
	 * state of a subscriber, arranged directly because most of what is interesting is a departure from it.
	 *
	 * <p>The tier is arranged rather than taken from the seeded catalog, for {@link TierEntitlementTest}'s
	 * reason: those numbers are an operator's to edit (ADR-0014), so a suite that spent the free rung's three
	 * would start failing the day somebody tuned it.
	 */
	Subscriber entitledTo(int relistsPerPeriod) {
		UUID tier = this.db.queryForObject("""
				insert into tier (code, name, relist_quota_per_period, max_marktplaats_accounts)
				values (?, 'A tier of this suite''s own', ?, 1) returning id
				""", UUID.class, this.tierCodePrefix + UUID.randomUUID(), relistsPerPeriod);
		String idpSubject = UUID.randomUUID().toString();
		UUID account = this.db.queryForObject("insert into app_user (idp_subject) values (?) returning id",
				UUID.class, idpSubject);
		OffsetDateTime provisioned = now().minusDays(1);
		this.db.update("""
				insert into subscription (app_user_id, tier_id, status, period_start, period_end)
				values (?, ?, 'active', ?, ?)
				""", account, tier, provisioned, provisioned.plusMonths(1));
		return new Subscriber(idpSubject, account, this.idp);
	}

	void statusIs(Subscriber user, String status) {
		this.db.update("update subscription set status = ? where app_user_id = ?", status, user.account());
	}

	void windowIs(Subscriber user, OffsetDateTime start, OffsetDateTime end) {
		this.db.update("update subscription set period_start = ?, period_end = ? where app_user_id = ?", start, end,
				user.account());
	}

	/** Signed up then, and never seen since: the created_at a roll anchors on, and the window #20 wrote. */
	void provisionedAt(Subscriber user, OffsetDateTime when) {
		this.db.update("update subscription set created_at = ? where app_user_id = ?", when, user.account());
		windowIs(user, when, when.plusMonths(1));
	}

	/** A subscription with a Stripe counterpart, whose window is Stripe's to move rather than ours. */
	void mirroredFromStripe(Subscriber user) {
		this.db.update("update subscription set stripe_subscription_id = ? where app_user_id = ?",
				"sub_" + UUID.randomUUID(), user.account());
	}

	/** A unit already held, without the authorization that would ordinarily have taken it. */
	UUID unitHeldBy(Subscriber user, OffsetDateTime when) {
		return this.db.queryForObject("""
				insert into usage_reservation (app_user_id, ad_id, reserved_at, expires_at)
				values (?, 'an-earlier-ad', ?, ?) returning id
				""", UUID.class, user.account(), when, when.plusSeconds(45));
	}

	void refunded(UUID reservation) {
		resolved(reservation, "REFUNDED");
	}

	void settled(UUID reservation) {
		resolved(reservation, "SETTLED");
	}

	void resolved(UUID reservation, String status) {
		this.db.update("update usage_reservation set status = ?, resolved_at = now() where id = ?", status,
				reservation);
	}

	/** Takes the row the application will want, on a connection the caller holds open across a call. */
	void lockTheSubscriptionOf(Connection connection, Subscriber user) throws SQLException {
		try (PreparedStatement lock = connection
				.prepareStatement("select id from subscription where app_user_id = ? for update")) {
			lock.setObject(1, user.account());
			lock.executeQuery().close();
		}
	}

	// --- reading back -----------------------------------------------------------------------------------

	List<Map<String, Object>> reservationsOf(Subscriber user) {
		return this.db.queryForList("""
				select id, ad_id, status, reserved_at, expires_at, resolved_at
				from usage_reservation where app_user_id = ?
				""", user.account());
	}

	/**
	 * The one reservation an account holds — where a second row would mean the call under test took a unit of
	 * its own, which is what {@link RelistCompletionTest} asserts of {@code /complete} throughout.
	 *
	 * <p>Throws rather than asserting, because "this account holds exactly one" is what the arrangement says
	 * about itself: a suite that reached here with two has not failed a claim about the application, it has
	 * stopped meaning what it says.
	 */
	Map<String, Object> theOnlyReservationOf(Subscriber user) {
		List<Map<String, Object>> held = reservationsOf(user);
		if (held.size() != 1) {
			throw new IllegalStateException("Expected one reservation for " + user.account() + ", found " + held);
		}
		return held.get(0);
	}

	List<Map<String, Object>> everyReservation() {
		return this.db.queryForList("select id from usage_reservation");
	}

	/** What the extension reported, joined back to the reservation it was reported against. */
	List<Map<String, Object>> eventsOf(Subscriber user) {
		return this.db.queryForList("""
				select event.reservation_id, event.outcome, event.recorded_at
				from relist_event event
				join usage_reservation reservation on reservation.id = event.reservation_id
				where reservation.app_user_id = ?
				""", user.account());
	}

	Window windowOf(Subscriber user) {
		Map<String, Object> period = this.db
				.queryForMap("select period_start, period_end from subscription where app_user_id = ?",
						user.account());
		return new Window(utc(period, "period_start"), utc(period, "period_end"));
	}

	/**
	 * A {@code timestamptz} out of a row read as a map, in UTC — which is the offset it was written in, and the
	 * one every comparison in these suites is about. {@link JdbcTemplate} hands these back as {@link Timestamp}
	 * rather than as the {@code java.time} value the column holds, and a {@code Timestamp} carries an instant
	 * with no offset of its own.
	 */
	static OffsetDateTime utc(Map<String, Object> row, String column) {
		Timestamp stored = (Timestamp) row.get(column);
		return stored == null ? null : stored.toInstant().atOffset(ZoneOffset.UTC);
	}

	static OffsetDateTime now() {
		return OffsetDateTime.now(ZoneOffset.UTC);
	}

	/**
	 * An account these suites can sign as, and the {@code app_user} row behind it.
	 *
	 * @param idpSubject the {@code sub} its tokens carry, which is what the application resolves the row by
	 * @param account our own id for it, which every table in the schema is keyed by
	 * @param idp the issuer that mints its tokens — one per suite, since each starts its own
	 */
	record Subscriber(String idpSubject, UUID account, MintedTokens idp) {

		String token() {
			return this.idp.token(claims -> claims.subject(this.idpSubject));
		}

	}

	record Window(OffsetDateTime start, OffsetDateTime end) {
	}

	private final JdbcTemplate db;

	private final MintedTokens idp;

	private final String tierCodePrefix;

}
