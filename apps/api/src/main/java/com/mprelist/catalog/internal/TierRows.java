package com.mprelist.catalog.internal;

import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import com.mprelist.catalog.Entitlement;
import com.mprelist.catalog.TierCatalog;
import com.mprelist.catalog.TierId;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * The {@code tier} table, and the only code in this application that reads it.
 *
 * <p>Plain SQL through {@link JdbcClient} rather than a mapped entity: nothing here loads a tier, mutates it
 * and writes it back — the seed writes the catalog and #27's admin endpoints will — so an ORM would buy a
 * persistence context this module has no use for and bring {@code ddl-auto}, a second schema author beside
 * the migrations, along with it.
 */
@Service
class TierRows implements TierCatalog {

	TierRows(JdbcClient db) {
		this.db = db;
	}

	@Override
	public TierId defaultTier() {
		return this.db.sql("select id from tier where is_default")
				.query(UUID.class)
				.optional()
				.map(TierId::new)
				.orElseThrow(() -> new IllegalStateException("No tier carries is_default, so there is no tier to "
						+ "provision a new account onto. V2__seed_tier_catalog.sql leaves Free holding it; an "
						+ "operator moving the flag has to move it to another tier rather than off every one."));
	}

	/**
	 * The three columns that say what the tier lets its holder do, and none of the ones that say what it costs
	 * or what it is called: {@code stripe_price_id} is #29's to read when it opens a Checkout session, and
	 * {@code name} is #26's when there is somebody to show it to.
	 *
	 * <p>{@code features::text} rather than the column itself, so the {@code jsonb} arrives as the JSON it is
	 * rather than as a driver-specific object this module would then be written against. Parsed here, so that
	 * an {@link Entitlement} carries the flags as data and no reader of one is handed a string to parse for
	 * itself.
	 */
	@Override
	public Entitlement entitlementOf(TierId tier) {
		return this.db
				.sql("select relist_quota_per_period, max_marktplaats_accounts, features::text from tier where id = ?")
				.param(tier.id())
				.query((row, number) -> new Entitlement(row.getInt("relist_quota_per_period"),
						row.getInt("max_marktplaats_accounts"), flagsIn(row.getString("features"))))
				.optional()
				.orElseThrow(() -> new IllegalStateException("No tier carries the id " + tier.id() + ", so there is "
						+ "nothing to resolve an entitlement from. A subscription references its tier behind a "
						+ "foreign key with no delete rule, so this is an id the catalog never issued rather than "
						+ "a tier that has been retired."));
	}

	private static Map<String, Object> flagsIn(String features) {
		return JSON.readValue(features, FLAGS);
	}

	private final JdbcClient db;

	/**
	 * This module's own, not the application's. The shared mapper is configured for what goes out over HTTP —
	 * #26 will have opinions about how {@code /api/me} renders — and the flags on the way out of our own column
	 * should not change shape because somebody tuned that.
	 */
	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final TypeReference<Map<String, Object>> FLAGS = new TypeReference<>() {
	};

}
