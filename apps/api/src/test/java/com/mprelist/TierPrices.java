package com.mprelist;

import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The prices a tier is sold at, arranged directly (T62, #128).
 *
 * <p>One home for it, like {@link Subscribers}, and for the same reason: seven suites arrange these rows and a
 * copy of the SQL in each is seven places a schema change has to be remembered. It also carries the one thing
 * a reader of those suites needs told — that a tier's prices are a *table* now, so "give this tier a price" is
 * an insert rather than a column, and "take its prices away" is a delete rather than a null.
 *
 * <p>Static rather than an object, unlike {@code Subscribers}: there is no per-suite state to hold. The tiers
 * these attach to are the seeded three, which every caller of this arranges for itself.
 */
final class TierPrices {

	/**
	 * Sold at this Stripe Price, by the month — which is what nearly every arrangement means, since one
	 * rhythm is what a tier had before this ticket.
	 */
	static void soldByTheMonth(JdbcTemplate db, String code, String stripePriceId) {
		soldAt(db, code, stripePriceId, "month");
	}

	/**
	 * Sold at this Stripe Price, at this rhythm. Replaces whatever that tier charged for the same rhythm,
	 * which is what repricing does and what the {@code unique (tier_id, billing_interval)} makes automatic.
	 */
	static void soldAt(JdbcTemplate db, String code, String stripePriceId, String interval) {
		db.update("""
				insert into tier_price (tier_id, stripe_price_id, billing_interval)
				select id, ?, ? from tier where code = ?
				on conflict (tier_id, billing_interval) do update set stripe_price_id = excluded.stripe_price_id
				""", stripePriceId, interval, code);
	}

	/**
	 * Nothing is on sale at any price.
	 *
	 * <p>Unpublishes first, because the two are one invariant: V7's trigger refuses a published tier with no
	 * price, and it is deferred to the end of the statement rather than the transaction — so the delete has to
	 * arrive after nothing is published, not merely in the same transaction as it.
	 */
	static void nothingIsPriced(JdbcTemplate db) {
		db.update("update tier set published = false");
		db.update("delete from tier_price");
	}

	/** What a tier is sold at, cheapest rhythm first — for a suite asserting what the sync wrote. */
	static List<String> of(JdbcTemplate db, String code) {
		return db.queryForList("""
				select stripe_price_id
				  from tier_price
				  join tier on tier.id = tier_price.tier_id
				 where tier.code = ?
				 order by billing_interval
				""", String.class, code);
	}

	/** The one Price a tier is sold at, or null where it is sold at none. Throws where it is sold at several. */
	static String only(JdbcTemplate db, String code) {
		List<String> prices = of(db, code);
		if (prices.size() > 1) {
			throw new IllegalStateException("The tier " + code + " is sold at " + prices + ", so 'the' price "
					+ "is not a question with an answer");
		}
		return prices.isEmpty() ? null : prices.get(0);
	}

	/** Which rhythms a tier is sold at, in the order the catalog returns them. */
	static List<String> intervalsOf(JdbcTemplate db, String code) {
		return db.queryForList("""
				select billing_interval
				  from tier_price
				  join tier on tier.id = tier_price.tier_id
				 where tier.code = ?
				 order by case billing_interval
				              when 'day' then 0 when 'week' then 1 when 'month' then 2 when 'year' then 3
				              else 4 end
				""", String.class, code);
	}

	private TierPrices() {
	}

}
