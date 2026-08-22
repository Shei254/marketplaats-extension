package com.mprelist.catalog.internal;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.mprelist.catalog.Adoption;
import com.mprelist.catalog.CatalogEntry;
import com.mprelist.catalog.Entitlement;
import com.mprelist.catalog.PriceAdoptions;
import com.mprelist.catalog.SellablePlan;
import com.mprelist.catalog.TaggedPrice;
import com.mprelist.catalog.TierCatalog;
import com.mprelist.catalog.TierEdit;
import com.mprelist.catalog.TierEdited;
import com.mprelist.catalog.TierEdits;
import com.mprelist.catalog.TierId;
import com.mprelist.catalog.TierName;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * The {@code tier} table, and the only code in this application that touches it.
 *
 * <p>Plain SQL through {@link JdbcClient} rather than a mapped entity: nothing here loads a tier, mutates it
 * and writes it back — the seed writes the catalog, the Stripe sync fills in a Price (#82) and T53's admin
 * endpoints will edit one — so an ORM would buy a persistence context this module has no use for and bring
 * {@code ddl-auto}, a second schema author beside the migrations, along with it.
 *
 * <p>It implements all three of this module's ports. They are separate types for their callers' sake (see
 * {@link PriceAdoptions} and {@link TierEdits}) and one class here for the table's: a second class writing
 * these columns is a second place the catalog's rules could be spelled differently — and with an operator
 * editing the same rows a webhook writes (T53, #84), "spelled differently" would mean the two disagreeing
 * about what a quota is allowed to be.
 */
@Service
class TierRows implements TierCatalog, PriceAdoptions, TierEdits {

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
	 * {@code name} is {@link #nameOf} below, which #26 added when there was somebody to show it to.
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

	/**
	 * The two columns that say what the tier is called, and neither of the ones that say what it grants.
	 *
	 * <p>Its own statement rather than one query serving both, so that the authorize path keeps reading the
	 * three columns it checks against and nothing else — a display label travelling on the hot path is a
	 * column a later reader could come to branch on.
	 */
	@Override
	public TierName nameOf(TierId tier) {
		return this.db.sql("select code, name from tier where id = ?")
				.param(tier.id())
				.query((row, number) -> new TierName(row.getString("code"), row.getString("name")))
				.optional()
				.orElseThrow(() -> new IllegalStateException("No tier carries the id " + tier.id() + ", so there is "
						+ "nothing to name. A subscription references its tier behind a foreign key with no delete "
						+ "rule, so this is an id the catalog never issued rather than a tier that has been "
						+ "retired."));
	}

	/**
	 * The five columns a plan card needs, in one statement and one round trip.
	 *
	 * <p>Ordered by what it grants, so the cards come back in the order a buyer reads them — cheapest first —
	 * rather than in whatever order Postgres happened to store them. That is a rendering decision made here
	 * because it is a `order by` rather than a sort in three clients.
	 *
	 * <p><strong>{@code published} alone is the whole filter, and that is not an omission.</strong> The other
	 * half of "sellable" is a price to charge against, and {@code V5__tier_publication.sql} makes a published
	 * tier without one <em>unwriteable</em> — so a second clause here would be a second place deciding the
	 * same thing, and one no test could tell the difference about. What would notice a row that broke the
	 * constraint anyway is {@link SellablePlan}'s own constructor, loudly, rather than a query quietly
	 * returning one fewer plan.
	 */
	@Override
	public List<SellablePlan> published() {
		return this.db.sql("""
				select code, name, relist_quota_per_period, max_marktplaats_accounts, features::text,
				       stripe_price_id
				  from tier
				 where published
				 order by relist_quota_per_period, code
				""")
				.query((row, number) -> new SellablePlan(new TierName(row.getString("code"), row.getString("name")),
						row.getString("stripe_price_id"),
						new Entitlement(row.getInt("relist_quota_per_period"),
								row.getInt("max_marktplaats_accounts"), flagsIn(row.getString("features")))))
				.list();
	}

	/**
	 * Which tier a Price belongs to, which is one index hit on {@code tier_stripe_price_id_key}.
	 *
	 * <p>No {@code published} clause, deliberately, and it is the one place in this class where that is worth
	 * saying: a subscriber renewing on a tier an operator has taken off sale is still on it, and a filter here
	 * would answer "no such tier" for exactly those people — whose next webhook would then grant them nothing
	 * (T20, #30). What is on sale is {@link #published()} and is a different question asked by a different
	 * caller.
	 */
	@Override
	public Optional<TierId> tierSoldAs(String stripePriceId) {
		return this.db.sql("select id from tier where stripe_price_id = ?")
				.param(stripePriceId)
				.query(UUID.class)
				.optional()
				.map(TierId::new);
	}

	/**
	 * The upsert ADR-0019 describes, as one statement and a read that says which half of it happened.
	 *
	 * <p>Three things are worth reading closely, because each is a rule stated somewhere else that this SQL is
	 * the whole of the enforcement of:
	 *
	 * <ul>
	 * <li>{@code relist_quota_per_period} appears only in the {@code insert}, and there only as the 0 a draft
	 * starts at. The {@code do update} arm cannot raise or lower a quota because it does not name the column.
	 * <li>{@code name} is written through a {@code coalesce}, so a Price with no nickname leaves the tier
	 * called what it was called rather than renaming Pro to nothing.
	 * <li>{@code published} is {@code tier.published or …}, so it only ever goes up, and only when the row is
	 * taking its <em>first</em> Price — inside an {@code update} every reference to a column is the old value,
	 * which is what makes {@code tier.stripe_price_id is null} mean "had none before this event".
	 * </ul>
	 *
	 * <p>The read before it is not part of the decision, only of the report: which of the first two happened is
	 * something an operator hears about, and under two deliveries of the same Price at once it may name the
	 * other one. The row is right either way, which is the half that matters — the upsert is one statement and
	 * the unique index on {@code code} is what serialises them.
	 */
	@Override
	@Transactional
	public Adoption adopt(TaggedPrice price) {
		if (heldByAnotherTier(price)) {
			return Adoption.LEFT_TO_THE_TIER_THAT_HOLDS_IT;
		}
		boolean known = this.db.sql("select count(*) from tier where code = ?")
				.param(price.tierCode())
				.query(Integer.class)
				.single() > 0;
		this.db.sql("""
				insert into tier (code, name, relist_quota_per_period, max_marktplaats_accounts,
				                  stripe_price_id, published)
				values (:code, coalesce(cast(:name as text), :code), 0, 1, :priceId, false)
				on conflict (code) do update
				   set stripe_price_id = excluded.stripe_price_id,
				       name = coalesce(cast(:name as text), tier.name),
				       published = tier.published
				                   or (tier.stripe_price_id is null and tier.relist_quota_per_period > 0)
				""")
				.param("code", price.tierCode())
				.param("name", price.name())
				.param("priceId", price.stripePriceId())
				.update();
		return known ? Adoption.FILLED_IN_A_TIER : Adoption.DRAFTED_A_TIER;
	}

	// --- what an operator sees and changes (T53, #84) ------------------------------------------------------

	/**
	 * Every row, in the order the plan cards use — cheapest grant first, then by code.
	 *
	 * <p>The same {@code order by} as {@link #published()} rather than a second opinion about how a catalog
	 * reads: an operator scanning their list and a buyer scanning the cards are looking at the same tiers, and
	 * two orders would make a screen hard to check against the other.
	 */
	@Override
	public List<CatalogEntry> everyTier() {
		return this.db.sql("""
				select code, name, relist_quota_per_period, features::text, published, is_default,
				       stripe_price_id
				  from tier
				 order by relist_quota_per_period, code
				""")
				.query((row, number) -> entry(row))
				.list();
	}

	/**
	 * The edit, as one statement and a read of what it left behind.
	 *
	 * <p><strong>The publish check is made here rather than left to the constraint</strong>, and that is the
	 * only place in this class that duplicates one. {@code tier_is_published_only_with_a_price} would refuse
	 * the row anyway, as a {@code DataIntegrityViolationException} somewhere under the route — a `500` and a
	 * stack trace where what is wanted is a sentence telling an operator to go and create a Price in Stripe.
	 * The constraint stays because it is what makes the rule true of every writer including this one; the
	 * check exists so that the one writer with a human in front of it can say what happened.
	 *
	 * <p>Read back inside the same transaction rather than assembled from the request, so the answer is the
	 * row — including the {@code stripe_price_id} the operator did not send and the {@code is_default} this
	 * does not touch.
	 */
	@Override
	@Transactional
	public TierEdited apply(String code, TierEdit edit) {
		Optional<CatalogEntry> stored = entryFor(code);
		if (stored.isEmpty()) {
			return new TierEdited.NoSuchTier();
		}
		if (edit.published() && stored.get().stripePriceId() == null) {
			return new TierEdited.NothingToChargeAgainst();
		}
		this.db.sql("""
				update tier
				   set name = :name,
				       relist_quota_per_period = :quota,
				       features = cast(:features as jsonb),
				       published = :published
				 where code = :code
				""")
				.param("name", edit.name())
				.param("quota", edit.relistQuotaPerPeriod())
				.param("features", JSON.writeValueAsString(edit.features()))
				.param("published", edit.published())
				.param("code", code)
				.update();
		return new TierEdited.Applied(entryFor(code).orElseThrow());
	}

	/**
	 * Move the flag, in two statements and one transaction.
	 *
	 * <p>Clear then set, rather than {@code set is_default = (code = :code)} in one pass:
	 * {@code tier_single_default} is a plain partial unique index, so it is checked row by row as a statement
	 * proceeds, and a single update that happened to set the new default before clearing the old one would
	 * fail on a duplicate that never outlives the statement. Two statements have no such moment. Not
	 * theoretical: {@code AdminTierTest}'s own setup was written the one-statement way and failed exactly
	 * like that, the first time a test that moves the flag ran before one that reads it.
	 *
	 * <p>The first clears <em>every</em> default, including this tier's own if it already held it, rather than
	 * sparing it with a {@code code <> :code}. That clause was here and is gone: re-setting the flag a
	 * statement later leaves exactly the same row, so it was a second place deciding the same thing and no
	 * test could tell the difference — which is #41's precedent for deleting one.
	 *
	 * <p>Nothing here can leave the catalog with no default: the two statements are one transaction, and a
	 * code naming no tier is refused before either runs.
	 */
	@Override
	@Transactional
	public Optional<CatalogEntry> makeDefault(String code) {
		if (entryFor(code).isEmpty()) {
			return Optional.empty();
		}
		this.db.sql("update tier set is_default = false where is_default").update();
		this.db.sql("update tier set is_default = true where code = ?").param(code).update();
		return entryFor(code);
	}

	private Optional<CatalogEntry> entryFor(String code) {
		return this.db.sql("""
				select code, name, relist_quota_per_period, features::text, published, is_default,
				       stripe_price_id
				  from tier
				 where code = ?
				""")
				.param(code)
				.query((row, number) -> entry(row))
				.optional();
	}

	/** One row, read the one way — three statements above hand back an entry and all three mean this. */
	private static CatalogEntry entry(ResultSet row) throws SQLException {
		return new CatalogEntry(new TierName(row.getString("code"), row.getString("name")),
				row.getInt("relist_quota_per_period"), flagsIn(row.getString("features")),
				row.getBoolean("published"), row.getBoolean("is_default"), row.getString("stripe_price_id"));
	}

	/**
	 * Whether some <em>other</em> tier already carries this Price id.
	 *
	 * <p>{@code tier.stripe_price_id} is unique, so adopting it anyway would either fail the constraint inside
	 * a webhook or — if it were written as a move — quietly leave the first tier with nothing to sell. Neither
	 * is an outcome for this module to choose, so it declines and says so.
	 */
	private boolean heldByAnotherTier(TaggedPrice price) {
		return this.db.sql("select count(*) from tier where stripe_price_id = :priceId and code <> :code")
				.param("priceId", price.stripePriceId())
				.param("code", price.tierCode())
				.query(Integer.class)
				.single() > 0;
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
