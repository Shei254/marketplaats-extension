package com.mprelist.catalog.internal;

import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import com.mprelist.catalog.TierCatalog;
import com.mprelist.catalog.TierId;

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

	private final JdbcClient db;

}
