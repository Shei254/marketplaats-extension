package com.mprelist;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.support.EncodedResource;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.transaction.annotation.Transactional;

/**
 * The catalog {@code V2__seed_tier_catalog.sql} leaves behind, read back from a real Postgres that Flyway
 * has just migrated. Unlike {@link BaselineSchemaTest}, whose subject is the constraints and which
 * therefore arranges its own rows, the subject here is the rows themselves — every assertion below is
 * about data that exists because the migration ran, so nothing is inserted.
 *
 * <p>Each test runs in a transaction that is rolled back, which matters only for the last one: it applies
 * the seed a second time.
 */
@SpringBootTest
@Import(PostgresFromCompose.class)
@Transactional
class TierCatalogSeedTest {

	@Autowired
	private JdbcTemplate db;

	@Test
	void theCatalogHoldsFreeProAndPower() {
		assertThat(db.queryForList("select code from tier", String.class)).containsExactlyInAnyOrder("free", "pro",
				"power");
	}

	/** #20 provisions onto whichever tier carries the flag, so which one it is is this file's to say. */
	@Test
	void freeIsTheTierEveryNewUserIsProvisionedOnto() {
		assertThat(db.queryForList("select code from tier where is_default", String.class)).containsExactly("free");
	}

	@Test
	void quotaRisesFromFreeToPower() {
		assertThat(db.queryForList("select code from tier order by relist_quota_per_period", String.class))
				.containsExactly("free", "pro", "power");
	}

	/**
	 * A free tier of zero would deny every relist with {@code QUOTA_EXCEEDED} before the product had shown
	 * anyone what it does, which is not what ADR-0014 means by making free an ordinary row.
	 */
	@Test
	void andTheFreeRungHasSomethingToSpend() {
		assertThat(quotaOf("free")).isPositive();
	}

	/**
	 * A sellable {@code maxMpAccounts} waits on #47: no stable Marktplaats account identifier has been
	 * found, so nothing can yet tell two of them apart.
	 */
	@Test
	void noTierSellsMoreThanOneMarktplaatsAccountYet() {
		assertThat(db.queryForList("select distinct max_marktplaats_accounts from tier", Integer.class))
				.containsExactly(1);
	}

	/**
	 * bulk and scheduling are named in docs/domain-model.md and implemented nowhere, and #26's
	 * {@code /api/me} hands whatever is here to the UI to render. Quota is the whole ladder today.
	 */
	@Test
	void andNoTierPromisesAFeatureThatDoesNotExist() {
		assertThat(db.queryForList("select distinct features::text from tier", String.class)).containsExactly("{}");
	}

	/**
	 * Free has no Stripe Price by design (ADR-0014); Pro and Power have none until #28 creates them by
	 * hand and a migration after it fills the ids in. So nothing in the catalog is purchasable yet, which
	 * is what #29 and #43 will find when they arrive.
	 */
	@Test
	void andNoTierCarriesAStripePriceUntilOneExists() {
		assertThat(db.queryForList("select code from tier where stripe_price_id is not null", String.class)).isEmpty();
	}

	/**
	 * The catalog is admin-managed after seeding (ADR-0014), so a second application — a restored dump, a
	 * hand-run — must not duplicate it or reset an edited quota. Comparing whole rows including {@code id}
	 * also catches the seed replacing a row rather than leaving it.
	 */
	@Test
	void applyingTheSeedAgainLeavesTheCatalogExactlyAsItWas() {
		List<Map<String, Object>> before = catalog();

		applyTheSeed();

		assertThat(catalog()).isEqualTo(before);
	}

	private Integer quotaOf(String code) {
		return db.queryForObject("select relist_quota_per_period from tier where code = ?", Integer.class, code);
	}

	private List<Map<String, Object>> catalog() {
		return db.queryForList("""
				select id, code, name, relist_quota_per_period, max_marktplaats_accounts, features::text,
				       is_default, stripe_price_id
				from tier order by code
				""");
	}

	private void applyTheSeed() {
		db.execute((ConnectionCallback<Void>) connection -> {
			ScriptUtils.executeSqlScript(connection, new EncodedResource(new ClassPathResource(SEED), UTF_8));
			return null;
		});
	}

	private static final String SEED = "db/migration/V2__seed_tier_catalog.sql";

}
