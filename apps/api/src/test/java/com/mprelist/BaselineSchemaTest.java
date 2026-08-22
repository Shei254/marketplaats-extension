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
	 * Whatever the catalog holds is another ticket's data — {@code V2__seed_tier_catalog.sql} puts Free, Pro
	 * and Power there, one of them the default, and {@link TierCatalogSeedTest} is what reads them back.
	 * These tests are about the constraints and arrange the whole catalog themselves, so they empty it
	 * first; the transaction is rolled back, so the seeded rows are still there afterwards.
	 */
	@BeforeEach
	void theCatalogIsOnlyWhatEachTestArranges() {
		db.update("delete from tier");
	}

	@Test
	void theMigrationCreatesTheTablesTheDomainModelOwns() {
		List<String> tables = db.queryForList(
				"select table_name from information_schema.tables where table_schema = 'public'", String.class);

		// `tier_price` joined them at T62 (#128), when a tier stopped being sold at one price and the column
		// that held it became a table of its own.
		assertThat(tables).containsExactlyInAnyOrder("app_user", "tier", "tier_price", "subscription",
				"usage_reservation", "relist_event", "flyway_schema_history");
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

	/**
	 * ADR-0014: the free tier is an ordinary row that happens to have no Stripe Price.
	 *
	 * <p>Since T62 (#128) a tier's prices are rows in {@code tier_price} rather than a column here, so "has no
	 * price" is "has no such row" — which is also how a tier comes to have <em>two</em>, one per rhythm.
	 */
	@Test
	void aTierNeedsNoStripePriceAndMoreThanOneMayLackIt() {
		twoTiersThatAreNotTheDefault();

		assertThat(db.queryForObject("""
				select count(*) from tier
				 where not exists (select 1 from tier_price where tier_price.tier_id = tier.id)
				""", Integer.class)).isEqualTo(2);
	}

	/**
	 * And it may have several, one per rhythm — which is the whole of T62 (#128) at the schema level, and what
	 * the single unique column could not express: monthly and annual Pro are one plan.
	 */
	@Test
	void andATierMayBeSoldAtMoreThanOnePriceProvidedTheyAreDifferentRhythms() {
		UUID tier = tier();
		db.update("insert into tier_price (tier_id, stripe_price_id, billing_interval) values (?, ?, 'month')",
				tier, "price_monthly");
		db.update("insert into tier_price (tier_id, stripe_price_id, billing_interval) values (?, ?, 'year')",
				tier, "price_yearly");

		assertThat(db.queryForObject("select count(*) from tier_price where tier_id = ?", Integer.class, tier))
				.isEqualTo(2);
	}

	/** But not twice at the same one, or "the monthly price" would stop being a question with an answer. */
	@Test
	void butNotTwiceAtTheSameRhythm() {
		UUID tier = tier();
		db.update("insert into tier_price (tier_id, stripe_price_id, billing_interval) values (?, ?, 'month')",
				tier, "price_monthly");

		assertThatThrownBy(() -> db.update(
				"insert into tier_price (tier_id, stripe_price_id, billing_interval) values (?, ?, 'month')",
				tier, "price_another"))
				.isInstanceOf(DuplicateKeyException.class)
				.hasMessageContaining("tier_price_tier_id_billing_interval_key");
	}

	@Test
	void butTwoTiersCannotShareOneStripePrice() {
		// Unchanged in meaning and moved in place: the reverse lookup the subscription mirror does would be a
		// choice rather than an answer if two tiers pointed at one Price.
		db.update("insert into tier_price (tier_id, stripe_price_id, billing_interval) values (?, ?, 'month')",
				tier(), "price_123");

		assertThatThrownBy(() -> db.update(
				"insert into tier_price (tier_id, stripe_price_id, billing_interval) values (?, ?, 'month')",
				tier(), "price_123"))
				.isInstanceOf(DuplicateKeyException.class).hasMessageContaining("tier_price_stripe_price_id_key");
	}

	/**
	 * And a published tier still cannot exist without something to charge against — the invariant V5 wrote as
	 * a {@code check} and V7 had to rewrite as a trigger, because it now spans two tables and a check
	 * constraint may not.
	 *
	 * <p>Both directions, which is more than the check could do: publishing a tier that has no price, and
	 * taking the last price away from one that is published. The second was never reachable before, since
	 * there was only ever one price and nulling it was the same statement as publishing.
	 */
	@Test
	void andAPublishedTierStillCannotExistWithNothingToChargeAgainst() {
		UUID tier = tier();

		assertThatThrownBy(() -> db.update("update tier set published = true where id = ?", tier))
				.hasMessageContaining("tier_is_published_only_with_a_price");
	}

	@Test
	void andItsLastPriceCannotBeTakenAwayWhileItIsOnSale() {
		UUID tier = tier();
		db.update("insert into tier_price (tier_id, stripe_price_id, billing_interval) values (?, ?, 'month')",
				tier, "price_only");
		db.update("update tier set published = true where id = ?", tier);

		assertThatThrownBy(() -> db.update("delete from tier_price where tier_id = ?", tier))
				.hasMessageContaining("tier_is_published_only_with_a_price");
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

	// The fixtures below name nothing the seed also names: its tier codes are real data in the same table,
	// and a test that collided with one would fail on the collision rather than on its subject.

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
