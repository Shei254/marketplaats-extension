package com.mprelist;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

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
 * <p>Each test runs in a transaction that is rolled back, which matters only for the last two: they apply
 * the seed a second time, and one of them edits a row first.
 */
@SpringBootTest
@Import(PostgresFromCompose.class)
@Transactional
class TierCatalogSeedTest {

	private static final String SEED = "db/migration/V2__seed_tier_catalog.sql";

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
	 * The one rung of the ladder that is not free configuration. Zero would deny every relist with
	 * {@code QUOTA_EXCEEDED} before the product had shown anyone what it does, which is not what ADR-0014
	 * means by making free an ordinary row — but any number other than three is wrong too, because ADR-0014's
	 * example of the locked state is "you've used your 3 — upgrade" and docs/enforcement-contract.md says the
	 * same. Pro and Power are deliberately not pinned: specs/quota-enforcement.md puts those outside its scope
	 * as configuration, and {@link #quotaRisesFromFreeToPower} holds all this file asks of them.
	 */
	@Test
	void andTheFreeRungIsTheThreeTheCopyPromises() {
		assertThat(quotaOf("free")).isEqualTo(3);
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
		assertThat(db.queryForList("select code from tier where features <> '{}'::jsonb", String.class)).isEmpty();
	}

	/**
	 * Free has no Stripe Price by design (ADR-0014); Pro and Power have none until #28 creates them by
	 * hand and a migration after it fills the ids in. So nothing in the catalog is purchasable yet, which
	 * is what #29 and #43 will find when they arrive.
	 */
	@Test
	void andNoTierCarriesAStripePriceUntilOneExists() {
		assertThat(db.queryForList("select stripe_price_id from tier_price", String.class)).isEmpty();
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

	/**
	 * And the half of that promise the test above cannot see. It re-applies the seed onto rows that still
	 * hold the seeded values, so an {@code on conflict (code) do update} would leave the catalog identical
	 * and pass it — overwriting and preserving are indistinguishable until something has been changed. This
	 * changes one first: ADR-0014 makes the catalog admin-managed after seeding, so a quota an operator has
	 * tuned must survive the restored dump or the hand-run that applies the file a second time.
	 */
	@Test
	void andAQuotaAnOperatorHasEditedStaysEdited() {
		db.update("update tier set relist_quota_per_period = 999 where code = 'pro'");

		applyTheSeed();

		assertThat(quotaOf("pro")).isEqualTo(999);
	}

	private Integer quotaOf(String code) {
		return db.queryForObject("select relist_quota_per_period from tier where code = ?", Integer.class, code);
	}

	private List<Map<String, Object>> catalog() {
		return db.queryForList("""
				select id, code, name, relist_quota_per_period, max_marktplaats_accounts, features::text,
				       is_default
				from tier order by code
				""");
	}

	private void applyTheSeed() {
		db.execute((ConnectionCallback<Void>) connection -> {
			ScriptUtils.executeSqlScript(connection, new EncodedResource(new ClassPathResource(SEED), UTF_8));
			return null;
		});
	}

}
