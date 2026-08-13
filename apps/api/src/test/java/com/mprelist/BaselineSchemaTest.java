package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

/**
 * What {@code V1__baseline_schema.sql} promises, asserted against a real Postgres that Flyway has just
 * migrated. The subject is the constraints: each is an invariant docs/domain-model.md states, and the point
 * of holding it in the schema is that no module can write around it by forgetting.
 *
 * <p>Each test runs in a transaction that is rolled back, and holds at most one constraint violation —
 * Postgres aborts the transaction on the first, so a second assertion in the same test would fail on the
 * abort rather than on the constraint it meant to prove.
 */
@SpringBootTest
@Import(PostgresFromCompose.class)
@Transactional
class BaselineSchemaTest {

	@Autowired
	private JdbcTemplate db;

	/**
	 * Whatever the catalog holds is another ticket's data — #18 seeds Free, Pro and Power, one of them the
	 * default. These tests are about the constraints and arrange the whole catalog themselves, so they
	 * empty it first; the transaction is rolled back, so the seeded rows are still there afterwards.
	 */
	@BeforeEach
	void theCatalogIsOnlyWhatEachTestArranges() {
		db.update("delete from tier");
	}

	@Test
	void theMigrationCreatesTheFiveTablesTheDomainModelOwns() {
		List<String> tables = db.queryForList(
				"select table_name from information_schema.tables where table_schema = 'public'", String.class);

		assertThat(tables).containsExactlyInAnyOrder("app_user", "tier", "subscription", "usage_reservation",
				"relist_event", "flyway_schema_history");
	}

	@Test
	void aSecondDefaultTierIsRejected() {
		defaultTier();

		assertThatThrownBy(this::defaultTier).isInstanceOf(DuplicateKeyException.class)
				.hasMessageContaining("tier_single_default");
	}

	/**
	 * The index is partial, and this is the difference: a plain {@code unique (is_default)} would pass the
	 * test above while forbidding a catalog of more than one paid tier.
	 */
	@Test
	void butTheCatalogMayHoldAnyNumberOfTiersThatAreNotTheDefault() {
		defaultTier();

		assertThatCode(this::twoTiersThatAreNotTheDefault).doesNotThrowAnyException();
	}

	/** ADR-0014: the free tier is an ordinary row that happens to have no Stripe Price. */
	@Test
	void aTierNeedsNoStripePriceAndMoreThanOneMayLackIt() {
		twoTiersThatAreNotTheDefault();

		assertThat(db.queryForObject("select count(*) from tier where stripe_price_id is null", Integer.class))
				.isEqualTo(2);
	}

	@Test
	void butTwoTiersCannotShareOneStripePrice() {
		db.update("update tier set stripe_price_id = 'price_123' where id = ?", tier());

		assertThatThrownBy(() -> db.update("update tier set stripe_price_id = 'price_123' where id = ?", tier()))
				.isInstanceOf(DuplicateKeyException.class).hasMessageContaining("tier_stripe_price_id_key");
	}

	@Test
	void aUserHasAtMostOneSubscription() {
		UUID user = user();
		UUID tier = tier();
		subscription(user, tier, "active");

		assertThatThrownBy(() -> subscription(user, tier, "active")).isInstanceOf(DuplicateKeyException.class)
				.hasMessageContaining("subscription_app_user_id_key");
	}

	@Test
	void aSubscriptionCarriesOneOfTheSevenNormalizedStatuses() {
		UUID tier = tier();

		assertThatCode(() -> {
			for (String status : List.of("active", "trialing", "past_due", "canceled", "unpaid", "incomplete",
					"incomplete_expired")) {
				subscription(user(), tier, status);
			}
		}).doesNotThrowAnyException();
	}

	@Test
	void andAStatusOutsideTheSevenIsRejected() {
		UUID tier = tier();

		// Stripe's own spelling of one of the seven. The mirror normalizes, it does not pass through.
		assertThatThrownBy(() -> subscription(user(), tier, "ACTIVE"))
				.isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("subscription_status_check");
	}

	@Test
	void aSubscriptionPeriodRunsForwards() {
		UUID tier = tier();

		assertThatThrownBy(() -> db.update("""
				insert into subscription (app_user_id, tier_id, status, period_start, period_end)
				values (?, ?, 'active', now(), now() - interval '1 day')
				""", user(), tier)).isInstanceOf(DataIntegrityViolationException.class)
						.hasMessageContaining("subscription_period_runs_forward");
	}

	/** Retiring a tier is the data migration ADR-0014 says it is, not a delete that orphans subscribers. */
	@Test
	void aTierWithSubscribersCannotBeDeleted() {
		UUID tier = tier();
		subscription(user(), tier, "active");

		assertThatThrownBy(() -> db.update("delete from tier where id = ?", tier))
				.isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("subscription_tier_id_fkey");
	}

	/**
	 * {@code POST /api/relist/complete} is idempotent per {@code jti}, and the reservation id is that
	 * {@code jti} — so a second report for one authorization collides here rather than depending on the
	 * service that writes it to have remembered the first.
	 */
	@Test
	void aReservationIsReportedOnAtMostOnce() {
		UUID reservation = reservation(user());
		report(reservation, "FAILED_BEFORE_DELETE");

		assertThatThrownBy(() -> report(reservation, "SUCCESS")).isInstanceOf(DuplicateKeyException.class)
				.hasMessageContaining("relist_event_reservation_id_key");
	}

	@Test
	void aResolvedReservationSaysWhenItWasResolved() {
		UUID reservation = reservation(user());

		assertThatThrownBy(() -> db.update("update usage_reservation set status = 'SETTLED' where id = ?", reservation))
				.isInstanceOf(DataIntegrityViolationException.class)
				.hasMessageContaining("usage_reservation_resolved_at_matches_status");
	}

	/** Including a refund, which resolves a reservation as surely as a settlement does. */
	@Test
	void aRefundedReservationSaysWhenItWasResolvedToo() {
		UUID reservation = reservation(user());

		assertThatThrownBy(() -> db.update("update usage_reservation set status = 'REFUNDED' where id = ?", reservation))
				.isInstanceOf(DataIntegrityViolationException.class)
				.hasMessageContaining("usage_reservation_resolved_at_matches_status");
	}

	@Test
	void aReservationStillHoldingItsUnitHasNoResolvedAt() {
		UUID reservation = reservation(user());

		assertThatThrownBy(() -> db.update("update usage_reservation set resolved_at = now() where id = ?", reservation))
				.isInstanceOf(DataIntegrityViolationException.class)
				.hasMessageContaining("usage_reservation_resolved_at_matches_status");
	}

	/** Feature flags are an object so that a flag can later carry a value; an array or a scalar is not one. */
	@Test
	void featuresIsAnObject() {
		assertThatThrownBy(() -> db.update("update tier set features = '[\"bulk\"]'::jsonb where id = ?", tier()))
				.isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("tier_features_check");
	}

	// The fixtures below name nothing a seed could also name: #18's tier codes are real data in the same
	// table, and a test that collided with one would fail on the collision rather than on its subject.

	private UUID user() {
		return db.queryForObject("insert into app_user (idp_subject) values (?) returning id", UUID.class,
				UUID.randomUUID().toString());
	}

	private UUID tier() {
		return tier(false);
	}

	/** Two ordinary catalog rows: neither flagged default, neither carrying a Stripe Price. */
	private void twoTiersThatAreNotTheDefault() {
		tier();
		tier();
	}

	private UUID defaultTier() {
		return tier(true);
	}

	private UUID tier(boolean isDefault) {
		return db.queryForObject("""
				insert into tier (code, name, relist_quota_per_period, max_marktplaats_accounts, is_default)
				values (?, 'A tier', 3, 1, ?) returning id
				""", UUID.class, UUID.randomUUID().toString(), isDefault);
	}

	private UUID subscription(UUID user, UUID tier, String status) {
		return db.queryForObject("""
				insert into subscription (app_user_id, tier_id, status, period_start, period_end)
				values (?, ?, ?, now(), now() + interval '1 month') returning id
				""", UUID.class, user, tier, status);
	}

	private UUID reservation(UUID user) {
		return db.queryForObject("""
				insert into usage_reservation (app_user_id, ad_id, expires_at)
				values (?, 'm2109876543', now() + interval '45 seconds') returning id
				""", UUID.class, user);
	}

	private void report(UUID reservation, String outcome) {
		db.update("insert into relist_event (reservation_id, outcome) values (?, ?)", reservation, outcome);
	}
}
