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
 * The catalog {@code V2__seed_tier_catalog.sql} leaves behind — and, since #147, what
 * {@code V8__seed_bulk_entitlement.sql} adds to it — read back from a real Postgres that Flyway has just
 * migrated. Unlike {@link BaselineSchemaTest}, whose subject is the constraints and which therefore arranges
 * its own rows, the subject here is the rows themselves — every assertion below is about data that exists
 * because the migrations ran, so nothing is inserted.
 *
 * <p>Each test runs in a transaction that is rolled back, which matters only for the last three: they apply a
 * seed a second time, and two of them edit a row first.
 */
@SpringBootTest
@Import(PostgresFromCompose.class)
@Transactional
class TierCatalogSeedTest {

	private static final String SEED = "db/migration/V2__seed_tier_catalog.sql";

	/**
	 * The second half of the seed (#147), and a separate file because V2 has been applied everywhere and
	 * Flyway validates the checksum of every file it has already run — the same reason V2 is not three more
	 * lines in V1. Re-applied beside it below, since "seeded, not owned" is a promise this file makes too.
	 */
	private static final String BULK_SEED = "db/migration/V8__seed_bulk_entitlement.sql";

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
	 * <strong>No tier promises a feature that does not exist</strong> — the rule this test has held since the
	 * catalog was seeded, and the reason it is written as a list of what <em>is</em> built rather than as
	 * "nothing is". #26's {@code /api/me} hands whatever is in this column to the UI to render, so a flag
	 * seeded ahead of the code behind it is an entitlement a client draws as available.
	 *
	 * <p>It had nothing to permit until #147. {@code bulk} is now built (ADR-0025,
	 * {@code V8__seed_bulk_entitlement.sql}), so the flag is allowed here and the test's <em>reason</em> is
	 * what had to survive the edit: {@code scheduling} is still named in docs/domain-model.md, still has no
	 * implementation and no ticket, and seeding it would be exactly the mistake this exists to catch. That is
	 * why the assertion names the built flags rather than counting them.
	 */
	@Test
	void andNoTierPromisesAFeatureThatDoesNotExist() {
		assertThat(db.queryForList("select distinct jsonb_object_keys(features) from tier", String.class))
				.containsExactly("bulk");
	}

	/**
	 * And the flag carries the number the popup caps a selection at, which is the shape ADR-0014 chose the
	 * column for: {@code features} is an object rather than a set of names so that a flag which later needs a
	 * value keeps its place, and this is the first one that does.
	 *
	 * <p>Both numbers are pinned, unlike Pro's and Power's quotas, and the difference is what a wrong one
	 * costs. A quota is configuration an operator tunes (specs/quota-enforcement.md); these two are drawn
	 * against the burst rail — ten fits one {@code mprelist.safety.burst-limit} window exactly, so the tier
	 * most people are on never sleeps mid-run, and twenty-five is the ~2 hour run ADR-0025 accepted with its
	 * eyes open. Moving either without re-reading that argument is what this would catch.
	 */
	@Test
	void andTheTiersThatCarryBulkSayHowManyAtATime() {
		assertThat(bulkOf("pro")).isEqualTo("{\"upTo\": 10}");
		assertThat(bulkOf("power")).isEqualTo("{\"upTo\": 25}");
	}

	/**
	 * Free carries none, which is not a row the seed forgot. The popup draws its selection controls from the
	 * entitlement rather than from a list of tier codes, so a locked checkbox beside somebody's own ads —
	 * ADR-0007's conversion surface, one surface further in — exists only because this tier genuinely does not
	 * grant the flag.
	 */
	@Test
	void butTheTierEveryNewAccountLandsOnDoesNot() {
		assertThat(bulkOf("free")).isNull();
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

	/**
	 * And the same promise for the flag, which is a second file making it and so a second chance to get it
	 * wrong. {@code upTo} is what the popup caps a selection at and it is an operator's to tune like any other
	 * number in this catalog — so a restored dump or a hand-run must not quietly put ten back.
	 *
	 * <p>What this deliberately does not assert is the other direction. A flag an operator took off a tier
	 * <em>is</em> written again by a second application, because "seed only where nothing has been said" cannot
	 * tell a deliberate removal from a tier that was never seeded — the same hole V2 has, where re-applying it
	 * re-creates a tier row somebody deleted. Taking bulk off a tier for good is the admin edit ADR-0014 makes
	 * the catalog's owner, not a migration nobody re-runs.
	 */
	@Test
	void andSoDoesABulkEntitlementAnOperatorHasEdited() {
		db.update("update tier set features = '{\"bulk\": {\"upTo\": 4}}'::jsonb where code = 'pro'");

		applyTheBulkSeed();

		assertThat(bulkOf("pro")).isEqualTo("{\"upTo\": 4}");
	}

	/** What a tier's {@code bulk} flag holds, as the JSON it is stored as, or null where it carries none. */
	private String bulkOf(String code) {
		return db.queryForObject("select (features -> 'bulk')::text from tier where code = ?", String.class, code);
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
		apply(SEED);
	}

	private void applyTheBulkSeed() {
		apply(BULK_SEED);
	}

	private void apply(String migration) {
		db.execute((ConnectionCallback<Void>) connection -> {
			ScriptUtils.executeSqlScript(connection, new EncodedResource(new ClassPathResource(migration), UTF_8));
			return null;
		});
	}

}
