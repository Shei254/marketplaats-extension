package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import com.mprelist.catalog.Entitlement;
import com.mprelist.catalog.TierCatalog;
import com.mprelist.catalog.TierId;

/**
 * What a tier grants, read back through {@link TierCatalog} from a real Postgres that Flyway has just
 * migrated (#21, ADR-0014). This is the question #22's gate asks of a subscriber's tier before it reserves a
 * unit, and #26's {@code /api/me} asks in order to render what the caller has.
 *
 * <p>Driven through the interface rather than against {@code TierRows}, because the interface is the whole of
 * what another module may hold: ADR-0012 puts the implementation in {@code internal} precisely so that
 * {@code enforcement} cannot come to depend on the answer arriving over JDBC.
 *
 * <p>Most of these arrange their own tiers, for the reason {@link BaselineSchemaTest} does — the seeded
 * catalog is another ticket's data and the values in it are an operator's to change, so a test that asserted
 * a grant against them would be asserting {@code V2__seed_tier_catalog.sql} a second time and would break the
 * day an admin edits a quota. {@link TierCatalogSeedTest} is where the seeded numbers are held. Each test runs
 * in a transaction that is rolled back, so the rows they add are gone afterwards.
 */
@SpringBootTest
@Import(PostgresFromCompose.class)
@Transactional
class TierEntitlementTest {

	@Test
	void aTierGrantsTheLimitsItsRowCarries() {
		TierId tier = tierGranting(7, 3, "{}");

		assertThat(this.catalog.entitlementOf(tier)).isEqualTo(new Entitlement(7, 3, Map.of()));
	}

	/**
	 * And the tier named is the tier resolved. A query that dropped its {@code where} would still answer the
	 * test above with whichever row Postgres reached first — the catalog is never a table of one, since the
	 * seed leaves three in it and the gate reads whichever tier its caller is subscribed to.
	 */
	@Test
	void andTheTierNamedIsTheOneResolvedRatherThanWhicheverRowCameFirst() {
		TierId cheap = tierGranting(3, 1, "{}");
		TierId generous = tierGranting(200, 1, "{}");

		assertThat(this.catalog.entitlementOf(cheap).relistsPerPeriod()).isEqualTo(3);
		assertThat(this.catalog.entitlementOf(generous).relistsPerPeriod()).isEqualTo(200);
	}

	/**
	 * Feature flags arrive as the data they are stored as, values and all. The column is an object rather than
	 * an array of names so that a flag which later needs a value — "bulk, up to 20 at a time" — stays in the
	 * same column (V1), and a resolution that read each flag as a bare boolean would throw that away on the
	 * first tier that used one.
	 */
	@Test
	void andTheFeatureFlagsItCarriesWithWhateverValuesTheyHold() {
		TierId tier = tierGranting(50, 1, """
				{"bulk": {"upTo": 20}, "scheduling": true}
				""");

		assertThat(this.catalog.entitlementOf(tier).features())
				.isEqualTo(Map.of("bulk", Map.of("upTo", 20), "scheduling", true));
	}

	/**
	 * A tier promising nothing beyond its quota grants no flags rather than a null nobody may read, which is
	 * every tier in the catalog today — the flags docs/domain-model.md names have no implementation, so
	 * {@code V2__seed_tier_catalog.sql} leaves the column at its {@code {}} default and #26 renders that empty
	 * object to the UI.
	 */
	@Test
	void andNoFlagsAtAllIsAnEmptySetOfThemRatherThanNothing() {
		TierId tier = tierGranting(3, 1, "{}");

		assertThat(this.catalog.entitlementOf(tier).features()).isEmpty();
	}

	/**
	 * And a flag an operator wrote with no value is data, not a fault. {@code jsonb} keeps a JSON {@code null}
	 * where {@code Map.copyOf} would refuse one, and the difference matters where this is read: a catalog that
	 * threw on it would deny that tier's subscribers their quota over a flag nothing has been written to read
	 * yet, and #26 would render the whole account unavailable for it.
	 */
	@Test
	void andAFlagLeftWithNoValueArrivesAsTheNullItIsStoredAs() {
		TierId tier = tierGranting(50, 1, """
				{"bulk": null}
				""");

		assertThat(this.catalog.entitlementOf(tier).features()).containsOnlyKeys("bulk").containsEntry("bulk", null);
	}

	/**
	 * The two questions this module answers, asked one after the other on the catalog as it really ships:
	 * which tier a new account lands on, and what that tier grants it. Every user is on one of these rows from
	 * their first request (#20), so this is the resolution the gate will do most.
	 *
	 * <p>It asserts that an answer arrives, not which numbers are in it. Those are the seed's promise and an
	 * operator's to edit afterwards (ADR-0014), so pinning them here would be a second copy of
	 * {@link TierCatalogSeedTest} that failed the first time somebody tuned the free rung.
	 */
	@Test
	void andTheTierEveryNewAccountLandsOnGrantsWhatTheCatalogSaysItDoes() {
		// `orElseThrow` rather than a get, and it is a claim about the seed rather than a convenience: since
		// T77 a catalog may have no default at all (ADR-0032), and this one ships with one.
		Entitlement free = this.catalog.entitlementOf(this.catalog.defaultTier().orElseThrow());

		assertThat(free.relistsPerPeriod()).isEqualTo(quotaOfTheDefaultTier());
		assertThat(free.maxMarktplaatsAccounts()).isPositive();
	}

	/**
	 * A {@link TierId} naming no row is not an entitlement of nothing, and it is not an empty {@code Optional}
	 * for the caller to guess at either. Every id this module hands out is a primary key, and a tier deleted out
	 * from under a subscriber leaves their {@code tier_id} null rather than dangling (T77, V11) — so a tier
	 * that cannot be found here means the id came
	 * from somewhere the catalog never wrote, and denying that caller their quota silently is the one answer
	 * that would hide it.
	 */
	@Test
	void butATierIdNamingNoRowIsAnErrorRatherThanAnEmptyGrant() {
		TierId nothing = new TierId(UUID.randomUUID());

		assertThatThrownBy(() -> this.catalog.entitlementOf(nothing)).isInstanceOf(IllegalStateException.class)
				.hasMessageContaining(nothing.id().toString());
	}

	/** A tier of this suite's own, named so that it collides with no row the seed also wrote. */
	private TierId tierGranting(int relistsPerPeriod, int maxMarktplaatsAccounts, String features) {
		return new TierId(this.db.queryForObject("""
				insert into tier (code, name, relist_quota_per_period, max_marktplaats_accounts, features)
				values (?, 'A tier', ?, ?, ?::jsonb) returning id
				""", UUID.class, UUID.randomUUID().toString(), relistsPerPeriod, maxMarktplaatsAccounts, features));
	}

	private Integer quotaOfTheDefaultTier() {
		return this.db.queryForObject("select relist_quota_per_period from tier where is_default", Integer.class);
	}

	@Autowired
	private TierCatalog catalog;

	@Autowired
	private JdbcTemplate db;

}
