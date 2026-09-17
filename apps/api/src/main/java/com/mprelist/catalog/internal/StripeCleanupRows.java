package com.mprelist.catalog.internal;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.mprelist.catalog.OutstandingCleanup;
import com.mprelist.catalog.StripeCleanup;
import com.mprelist.catalog.TierTeardown;

/**
 * The {@code stripe_cleanup} table (T77, ADR-0032), and the only code that touches it.
 *
 * <p>Beside {@link TierRows} rather than inside it, because it is a different table with a different
 * lifetime: {@code tier} is a catalog somebody maintains and this is a work queue that drains. What makes
 * them one module is the one question that spans both — whether a code is still being torn down — which
 * {@code TierRows.adopt} asks on every price event.
 *
 * <p>Plain SQL through {@link JdbcClient} for {@code TierRows}' reason: nothing here loads a row, mutates it
 * and writes it back. Each write is one statement about one row.
 */
@Service
class StripeCleanupRows implements TierTeardown {

	StripeCleanupRows(JdbcClient db) {
		this.db = db;
	}

	/**
	 * One statement per id, and {@code on conflict do nothing} against the partial unique index — which is
	 * what makes offering the same Stripe object twice free rather than a duplicate call.
	 *
	 * <p><strong>It joins whatever transaction it is called in rather than demanding one</strong>, and both
	 * callers matter. A delete calls it inside the transaction that deletes the row, which is the only moment
	 * the ids exist to be copied — {@code tier_price} cascades, the Product id was never stored, and the
	 * ex-subscribers become indistinguishable from any other deletion's orphans. The drain calls it too, on
	 * its own, to add the {@code ARCHIVE_PRODUCT} a {@code retrieve} has just told it about; that one is a row
	 * this table learns about later by design, so a {@code MANDATORY} here would refuse the caller it exists
	 * to serve.
	 */
	@Override
	@Transactional
	public void enqueue(String tierCode, StripeCleanup kind, List<String> stripeIds) {
		for (String stripeId : stripeIds) {
			this.db.sql("""
					insert into stripe_cleanup (tier_code, kind, stripe_id)
					values (?, ?, ?)
					on conflict do nothing
					""")
					.params(tierCode, stored(kind), stripeId)
					.update();
		}
	}

	/**
	 * Oldest first, so that a tier deleted an hour ago finishes before one deleted a moment ago starts.
	 *
	 * <p>No {@code for update} and no lock of any kind, unlike every other queue-shaped read in this
	 * application. Two instances draining at once make each call twice, and every call behind these rows is a
	 * statement of the state wanted rather than a change to it — archived, untagged, cancelled — so the second
	 * one is a no-op at Stripe. A lock would buy nothing and would make a drain that died mid-run hold the
	 * queue until something noticed.
	 */
	@Override
	public List<OutstandingCleanup> outstanding(int limit) {
		return this.db.sql("""
				select id, tier_code, kind, stripe_id, attempts
				  from stripe_cleanup
				 where done_at is null
				 order by enqueued_at, id
				 limit ?
				""")
				.param(limit)
				.query((row, number) -> new OutstandingCleanup(row.getObject("id", UUID.class),
						row.getString("tier_code"), kindIn(row.getString("kind")), row.getString("stripe_id"),
						row.getInt("attempts")))
				.list();
	}

	/**
	 * {@code where done_at is null} on the way in as well as in the index, so that two drains finishing the
	 * same call leave the first one's timestamp rather than the second's — the moment Stripe agreed, not the
	 * moment the second instance found out.
	 */
	@Override
	public void done(UUID call) {
		this.db.sql("update stripe_cleanup set done_at = now() where id = ? and done_at is null")
				.param(call)
				.update();
	}

	/**
	 * The attempt counted and Stripe's sentence kept, which together are the whole of what makes a row nobody
	 * can drain visible as itself rather than as a queue that is never empty.
	 *
	 * <p>{@code attempts + 1} in the statement rather than a number the caller worked out, so two drains that
	 * both failed on one row count two attempts rather than one.
	 */
	@Override
	public void failed(UUID call, String why) {
		this.db.sql("""
				update stripe_cleanup
				   set attempts = attempts + 1, last_error = ?
				 where id = ? and done_at is null
				""")
				.params(why, call)
				.update();
	}

	/** One index hit on {@code stripe_cleanup_outstanding}, which is partial on exactly this predicate. */
	@Override
	public boolean isBeingTornDown(String tierCode) {
		return this.db.sql("select count(*) from stripe_cleanup where tier_code = ? and done_at is null")
				.param(tierCode)
				.query(Integer.class)
				.single() > 0;
	}

	/**
	 * The column's spelling, which is the check constraint's: lower case with underscores. Here rather than on
	 * the enum for {@code SubscriptionRows}' reason — how a value is spelled in a column is the adapter's
	 * business, and {@link StripeCleanup} is what the rest of the application reads.
	 */
	private static String stored(StripeCleanup kind) {
		return kind.name().toLowerCase(Locale.ROOT);
	}

	/** The other direction, beside it so that a kind written one way and read another is two adjacent lines. */
	private static StripeCleanup kindIn(String stored) {
		try {
			return StripeCleanup.valueOf(stored.toUpperCase(Locale.ROOT));
		}
		catch (IllegalArgumentException outsideTheThree) {
			throw new IllegalStateException("The cleanup kind '" + stored + "' is not one of the three "
					+ "StripeCleanup names, so either stripe_cleanup_kind_check has been widened without this "
					+ "enum or the row was written around it", outsideTheThree);
		}
	}

	private final JdbcClient db;

}
