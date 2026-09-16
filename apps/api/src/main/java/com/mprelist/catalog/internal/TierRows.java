package com.mprelist.catalog.internal;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
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
import com.mprelist.catalog.TierPrice;

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
				.query((row, number) -> new Entitlement(quotaStored(row),
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
	 * <p><strong>In the Catalog order</strong> — the sequence an operator set in {@code /admin} (T75,
	 * ADR-0030), of which this is the published subsequence. Still an {@code order by} here rather than a sort
	 * in three clients, and still the same clause {@link #everyTier()} reads, which is the property that keeps
	 * the two screens agreeing. What changed in T75 is only what the clause says: it was
	 * {@code relist_quota_per_period, code} until then — cheapest grant first — which is a sensible default
	 * and cannot express which plan an operator wants bought.
	 *
	 * <p>{@code , code} is the tie-break rather than a second opinion: {@code position} carries no
	 * {@code unique} (ADR-0030 argues why at length), so two rows sharing one read as a stable alphabetical
	 * pair instead of as a list that reshuffles between requests.
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
		Map<UUID, List<TierPrice>> prices = pricesByTier();
		return this.db.sql("""
				select id, code, name, relist_quota_per_period, max_marktplaats_accounts, features::text
				  from tier
				 where published
				 order by position, code
				""")
				.query((row, number) -> new SellablePlan(new TierName(row.getString("code"), row.getString("name")),
						prices.getOrDefault(row.getObject("id", UUID.class), List.of()),
						new Entitlement(quotaStored(row), row.getInt("max_marktplaats_accounts"),
								flagsIn(row.getString("features")))))
				.list();
	}

	/**
	 * Every tier's prices, in one statement rather than one per tier (T62, #128).
	 *
	 * <p>Two round trips for the whole catalog, where a join would have been one and a query per tier would
	 * have been N. Kept apart because a tier with two prices would otherwise arrive as two rows of tier, and
	 * reassembling that costs more code than a second statement costs time — on a table of a handful of rows.
	 *
	 * <p>Ordered by rhythm rather than alphabetically, so {@code month} precedes {@code year}: it is the order
	 * a buyer reads two prices in, decided here because it is an {@code order by} rather than a sort in every
	 * client.
	 */
	private Map<UUID, List<TierPrice>> pricesByTier() {
		Map<UUID, List<TierPrice>> byTier = new LinkedHashMap<>();
		this.db.sql("""
				select tier_id, stripe_price_id, billing_interval
				  from tier_price
				 order by case billing_interval
				              when 'day' then 0 when 'week' then 1 when 'month' then 2 when 'year' then 3
				              else 4 end,
				          billing_interval
				""")
				.query((row, number) -> Map.entry(row.getObject("tier_id", UUID.class),
						new TierPrice(row.getString("stripe_price_id"), row.getString("billing_interval"))))
				.list()
				.forEach(entry -> byTier.computeIfAbsent(entry.getKey(), tier -> new ArrayList<>())
						.add(entry.getValue()));
		return byTier;
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
		return this.db.sql("select tier_id from tier_price where stripe_price_id = ?")
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
	 * starts at — still 0 and not the {@code null} ADR-0029 added, because a draft is "nobody has said what
	 * this grants" and unlimited is somebody saying it. The {@code do update} arm cannot raise or lower a
	 * quota because it does not name the column.
	 * <li>{@code name} is written through a {@code coalesce}, so a Price with no nickname leaves the tier
	 * called what it was called rather than renaming Pro to nothing.
	 * <li>{@code published} is {@code tier.published or …}, so it only ever goes up, and only when the row is
	 * taking its <em>first</em> Price — inside an {@code update} every reference to a column is the old value,
	 * which is what makes {@code tier.stripe_price_id is null} mean "had none before this event".
	 * <li>{@code position} is named nowhere, and that is T75's doing rather than an omission
	 * (ADR-0030): {@code V10__catalog_order.sql}'s {@code tier_is_placed_last} fills an unstated place with
	 * the one after the catalog's last, so a tier this webhook drafts arrives at the bottom of the admin table
	 * — where a new thing to deal with belongs — and it cannot reach the plan cards at all until somebody
	 * publishes it. In the schema rather than here, so it is true of the seed and of every fixture too.
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

		// The tier itself: created as a draft if the code is new, renamed through a `coalesce` if it is not,
		// and its quota never written either way — ADR-0019's central rule, and V2's own.
		UUID tier = this.db.sql("""
				insert into tier (code, name, relist_quota_per_period, max_marktplaats_accounts)
				values (:code, coalesce(cast(:name as text), :code), 0, 1)
				on conflict (code) do update
				   set name = coalesce(cast(:name as text), tier.name)
				returning id
				""")
				.param("code", price.tierCode())
				.param("name", price.name())
				.query(UUID.class)
				.single();

		boolean hadNoPriceBefore = this.db.sql("select count(*) from tier_price where tier_id = ?")
				.param(tier)
				.query(Integer.class)
				.single() == 0;

		/*
		 * The price, keyed on the tier and the rhythm — which is what makes a tier's monthly and annual prices
		 * two rows rather than a collision (T62, #128), and what keeps repricing an update: a new monthly
		 * Price tagged `pro` replaces the monthly row and leaves the annual one alone.
		 *
		 * Before this table there was one column, so the second Price tagged with a code overwrote the first
		 * whatever its rhythm — the bug ADR-0019 wrote down and could not fix without a migration.
		 */
		this.db.sql("""
				insert into tier_price (tier_id, stripe_price_id, billing_interval)
				values (:tier, :priceId, :interval)
				on conflict (tier_id, billing_interval) do update
				   set stripe_price_id = excluded.stripe_price_id
				""")
				.param("tier", tier)
				.param("priceId", price.stripePriceId())
				.param("interval", price.interval())
				.update();

		/*
		 * Publishing still happens once, on the first price to land on a tier that grants something — which is
		 * what fills in the seeded `pro` and `power`. A *second* price on an already-priced tier leaves
		 * `published` exactly as it was, so adding an annual rhythm never puts a withdrawn plan back on sale.
		 *
		 * "Grants something" is now `> 0 or is null` rather than `> 0` (ADR-0029): an unlimited tier grants
		 * everything, and under the old spelling it would have been the one tier that never went on sale when
		 * its Price landed, precisely because it is the best one. The same condition is `V9`'s trigger and
		 * `TierEdited.NothingToGrant`, which is what makes the two publish paths agree.
		 */
		if (hadNoPriceBefore) {
			this.db.sql("""
					update tier set published = true
					 where id = ?
					   and (relist_quota_per_period > 0 or relist_quota_per_period is null)
					""")
					.param(tier)
					.update();
		}
		return known ? Adoption.FILLED_IN_A_TIER : Adoption.DRAFTED_A_TIER;
	}

	/**
	 * Whether some <em>other</em> tier already carries this Price id.
	 *
	 * <p>{@code tier_price.stripe_price_id} is unique, so adopting it anyway would either fail the constraint
	 * inside a webhook or — if it were written as a move — quietly leave the first tier with one fewer rhythm
	 * to sell. Neither is an outcome for this module to choose, so it declines and says so.
	 */
	private boolean heldByAnotherTier(TaggedPrice price) {
		return this.db.sql("""
				select count(*)
				  from tier_price
				  join tier on tier.id = tier_price.tier_id
				 where tier_price.stripe_price_id = :priceId
				   and tier.code <> :code
				""")
				.param("priceId", price.stripePriceId())
				.param("code", price.tierCode())
				.query(Integer.class)
				.single() > 0;
	}

	// --- what an operator sees and changes (T53, #84) ------------------------------------------------------

	/**
	 * Every row, in the Catalog order — including the rows no buyer ever sees.
	 *
	 * <p>The same {@code order by} as {@link #published()} rather than a second opinion about how a catalog
	 * reads: an operator scanning their list and a buyer scanning the cards are looking at the same tiers, and
	 * two orders would make a screen hard to check against the other. Since T75 that is not merely a courtesy
	 * — this is the screen the order is <em>set</em> on, so a list that read differently from the cards would
	 * be a control whose effect is invisible from where it is operated.
	 *
	 * <p>The free tier and every draft carry a place too, which is why dragging {@code free} above {@code pro}
	 * changes nothing a buyer sees. That is deliberate (ADR-0030): publishing is a checkbox on a form opened
	 * for other reasons, so a position that survived only while a tier was on sale would lose an operator's
	 * arrangement the first afternoon somebody withdrew a plan.
	 */
	@Override
	public List<CatalogEntry> everyTier() {
		Map<UUID, List<TierPrice>> prices = pricesByTier();
		return this.db.sql("""
				select id, code, name, relist_quota_per_period, features::text, published, is_default
				  from tier
				 order by position, code
				""")
				.query((row, number) -> entry(row, prices))
				.list();
	}

	/**
	 * The edit, as one statement and a read of what it left behind.
	 *
	 * <p><strong>The two publish checks are made here rather than left to the triggers</strong>, and they are
	 * the only place in this class that duplicates one. {@code tier_is_published_only_with_a_price} and
	 * {@code tier_is_published_only_when_it_grants_something} would refuse the row anyway, as a
	 * {@code DataIntegrityViolationException} somewhere under the route — a `500` and a stack trace where
	 * what is wanted is a sentence telling an operator to go and create a Price in Stripe, or to say what the
	 * plan grants before selling it. The triggers stay because they are what makes the rules true of every
	 * writer including this one; the checks exist so that the one writer with a human in front of it can say
	 * what happened.
	 *
	 * <p><strong>The code moves only where nothing else holds a copy of it</strong> (T76, ADR-0031), and the
	 * guard is the tier's own price list rather than a query of its own: a {@code tier_price} row means Stripe
	 * carries the code as {@code metadata.tier_code}, which is what {@link #adopt} finds the tier by. The
	 * {@code stored} entry above has already read the prices, so "has a Price" is the same fact the publish
	 * check one line down is asking about — read once and asked twice rather than two statements that could
	 * come to disagree.
	 *
	 * <p>Both code checks are made before the publish ones because they are about <em>which row this is</em>
	 * rather than about what it may be sold for: an edit that moves a frozen code is refused whether or not
	 * it also tried to put the tier on sale, and being told the sellable thing first would send an operator to
	 * fix the wrong half of their form.
	 *
	 * <p>Read back inside the same transaction rather than assembled from the request, so the answer is the
	 * row — including the {@code stripe_price_id} the operator did not send and the {@code is_default} this
	 * does not touch. Read back by the code the edit <em>asked for</em>, since that is where the row now is.
	 */
	@Override
	@Transactional
	public TierEdited apply(String code, TierEdit edit) {
		Optional<CatalogEntry> stored = entryFor(code);
		if (stored.isEmpty()) {
			return new TierEdited.NoSuchTier();
		}
		boolean moving = !edit.code().equals(code);
		if (moving && !stored.get().isFree()) {
			return new TierEdited.CodeFrozenByAPrice();
		}
		// Any row under the asked-for code is another tier's, because this branch is only reached where the
		// two codes differ. `tier.code` is unique, so the alternative to answering here is the constraint
		// failing under the route as a 500.
		if (moving && entryFor(edit.code()).isPresent()) {
			return new TierEdited.CodeTakenByAnotherTier();
		}
		if (edit.published() && stored.get().isFree()) {
			return new TierEdited.NothingToChargeAgainst();
		}
		if (edit.published() && edit.grantsNothing()) {
			return new TierEdited.NothingToGrant();
		}
		this.db.sql("""
				update tier
				   set code = :newCode,
				       name = :name,
				       relist_quota_per_period = :quota,
				       features = cast(:features as jsonb),
				       published = :published
				 where code = :code
				""")
				.param("newCode", edit.code())
				.param("name", edit.name())
				.param("quota", edit.relistQuotaPerPeriod())
				.param("features", JSON.writeValueAsString(edit.features()))
				.param("published", edit.published())
				.param("code", code)
				.update();
		return new TierEdited.Applied(entryFor(edit.code()).orElseThrow());
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

	/**
	 * Rewrite the Catalog order, as one statement over a list that has to be the catalog exactly (T75, #164;
	 * ADR-0030).
	 *
	 * <p><strong>The whole sequence, never one row's index.</strong> Moving a tier moves others, so a
	 * {@code position} on {@link #apply} would turn one drag into N requests a client sequenced itself,
	 * non-atomically, leaving an order nobody chose if the third one failed. It is a property of the catalog
	 * rather than of a row, which is the same reason {@code isDefault} is not on {@link TierEdit}.
	 *
	 * <p><strong>One refusal, and it is a set comparison.</strong> A code the catalog does not hold, a tier the
	 * list forgot and a code named twice are one event from the only caller's point of view — the screen is
	 * stale, and the answer is to reload it. Read inside this transaction, so it doubles as the concurrency
	 * check the route needs for free: a draft the Stripe sync adopted while the page was open makes the list
	 * incomplete, and the write fails loudly instead of silently filing the new tier wherever the renumbering
	 * happened to leave it.
	 *
	 * <p>The codes travel to Postgres as a {@code jsonb} array rather than as a bound {@code text[]}, which is
	 * the idiom {@link #apply} already uses one method up for the flags: {@code with ordinality} then turns the
	 * position in the list into the position in the catalog, so the renumbering is 1..N in a single pass and
	 * there is no moment at which two rows have swapped halfway.
	 *
	 * <p><strong>Nothing here needs a {@code unique} on the column and nothing here would tolerate one.</strong>
	 * A swap violates a non-deferrable {@code unique (position)} mid-statement, so the constraint would have to
	 * be {@code deferrable initially deferred} — which V7 has already shown is a check a rolled-back transaction
	 * never runs. Distinctness is this method's, by being the only writer that ever sets a position other than
	 * "last".
	 *
	 * @param codes every tier in the catalog, in the order the plan cards should read
	 * @return the catalog as it now stands, or nothing when {@code codes} is not exactly its set
	 */
	@Override
	@Transactional
	public Optional<List<CatalogEntry>> reorder(List<String> codes) {
		Set<String> asked = new LinkedHashSet<>(codes);
		if (asked.size() != codes.size()) {
			return Optional.empty();
		}
		Set<String> held = new LinkedHashSet<>(this.db.sql("select code from tier").query(String.class).list());
		if (!asked.equals(held)) {
			return Optional.empty();
		}
		this.db.sql("""
				update tier
				   set position = cast(placed.place as integer)
				  from jsonb_array_elements_text(cast(:codes as jsonb)) with ordinality as placed(code, place)
				 where tier.code = placed.code
				""")
				.param("codes", JSON.writeValueAsString(codes))
				.update();
		return Optional.of(everyTier());
	}

	private Optional<CatalogEntry> entryFor(String code) {
		Map<UUID, List<TierPrice>> prices = pricesByTier();
		return this.db.sql("""
				select id, code, name, relist_quota_per_period, features::text, published, is_default
				  from tier
				 where code = ?
				""")
				.param(code)
				.query((row, number) -> entry(row, prices))
				.optional();
	}

	/** One row, read the one way — three statements above hand back an entry and all three mean this. */
	private static CatalogEntry entry(ResultSet row, Map<UUID, List<TierPrice>> prices) throws SQLException {
		return new CatalogEntry(new TierName(row.getString("code"), row.getString("name")), quotaStored(row),
				flagsIn(row.getString("features")), row.getBoolean("published"), row.getBoolean("is_default"),
				prices.getOrDefault(row.getObject("id", UUID.class), List.of()));
	}

	/**
	 * The quota column, boxed — {@code getInt} answers 0 for a SQL {@code null}, which is the one other value
	 * in this column that means something (ADR-0029) and the reason every read of it goes through here.
	 */
	private static Integer quotaStored(ResultSet row) throws SQLException {
		return row.getObject("relist_quota_per_period", Integer.class);
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
