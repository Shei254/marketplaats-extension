package com.mprelist.subscription.internal;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.mprelist.catalog.TierCatalog;
import com.mprelist.catalog.TierId;
import com.mprelist.identity.UserRef;
import com.mprelist.subscription.Mirroring;
import com.mprelist.subscription.QuotaPeriod;
import com.mprelist.subscription.SubscriberOnStripe;
import com.mprelist.subscription.Subscription;
import com.mprelist.subscription.SubscriptionMirror;
import com.mprelist.subscription.SubscriptionStatus;
import com.mprelist.subscription.Subscriptions;

/**
 * The {@code subscription} table as everything outside this module sees it, and the only code that reads it.
 *
 * <p>Plain SQL through {@link JdbcClient} for {@code TierRows}' reason: nothing here loads a subscription,
 * mutates it and writes it back, so an ORM would buy a persistence context this module has no use for. Every
 * write here is one {@code update} of the columns it names — the roll of a free window, and the two halves of
 * the Stripe mirror (#30).
 *
 * <p>It implements both of this module's ports, which are separate types for their callers' sake (see
 * {@link SubscriptionMirror}) and one class here for the table's: a second class writing these columns is a
 * second place the window, the status and the tier could be spelled differently.
 */
@Service
class SubscriptionRows implements Subscriptions, SubscriptionMirror {

	/**
	 * @param tiers read on the way out of a subscription rather than into one: which tier a Stripe Price is
	 * the price of, and which tier somebody falls back to when Stripe says their subscription ended. Both are
	 * the catalog's to answer and neither is a column of this table
	 */
	SubscriptionRows(JdbcClient db, TierCatalog tiers) {
		this.db = db;
		this.tiers = tiers;
	}

	/**
	 * {@code MANDATORY}, so this cannot be called outside a transaction rather than quietly doing nothing
	 * useful in one statement each. Both halves of what {@link Subscriptions#currentFor} promises depend on
	 * there being one: {@code for update} holds the row only until the enclosing transaction ends, and rolling
	 * the window is a write that has to commit with whatever the caller does on the strength of it. Without
	 * this, a gate that lost its own {@code @Transactional} would still take the lock — and release it one
	 * statement later, leaving two concurrent callers free to spend the same last unit, with nothing but a race
	 * left to notice. With it, that mutation fails 24 of the 27 tests in {@code RelistAuthorizationTest} rather
	 * than whichever ones happened to overlap.
	 */
	/**
	 * One column, no lock and no transaction of its own.
	 *
	 * <p>Unlike {@link #currentFor(UserRef)} this is not read-then-write: the caller is about to send somebody
	 * to Stripe, and nothing it does depends on the row staying still — the worst a concurrent change can do
	 * is send a returning subscriber to Checkout as a new customer, which is the state this exists to avoid
	 * rather than one it would create.
	 *
	 * <p>Answers empty rather than throwing for a missing account, which is the opposite of the read above and
	 * deliberate: there the absence is a broken invariant a gate would misread as an exhausted quota; here the
	 * absence is the ordinary case — every free user has no customer id — and the caller's next move is the
	 * same either way.
	 */
	@Override
	public Optional<String> stripeCustomerFor(UserRef user) {
		return this.db.sql("select stripe_customer_id from subscription where app_user_id = ?")
				.param(user.id())
				.query(String.class)
				.optional();
	}

	@Override
	@Transactional(propagation = Propagation.MANDATORY)
	public Subscription currentFor(UserRef user) {
		Row row = this.db.sql("""
				select id, tier_id, status, period_start, period_end, created_at,
				       stripe_subscription_id is not null as stripes
				from subscription
				where app_user_id = ?
				for update
				""")
				.param(user.id())
				.query((values, number) -> new Row(values.getObject("id", UUID.class),
						new TierId(values.getObject("tier_id", UUID.class)), statusIn(values.getString("status")),
						new QuotaPeriod(utc(values.getObject("period_start", OffsetDateTime.class)),
								utc(values.getObject("period_end", OffsetDateTime.class))),
						utc(values.getObject("created_at", OffsetDateTime.class)), values.getBoolean("stripes")))
				.optional()
				.orElseThrow(() -> new IllegalStateException("The account " + user.id() + " holds no subscription, "
						+ "which ADR-0014 makes unreachable: first login provisions one on the default tier in "
						+ "the transaction that creates the account. A row deleted underneath a live account is "
						+ "the only way to arrive here."));
		// Read after the row rather than before it, so that a window rolled to start at this instant cannot
		// start after a `now` the caller already holds — the reservation it goes on to write would then be
		// stamped before its own period and counted against nobody's quota.
		OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
		return row.windowIsOursToRoll() && row.period().hasClosedBy(now) ? rolledForward(row, now)
				: row.asSeenByOthers();
	}

	/**
	 * The next whole calendar month of this subscription's own window, written back and answered with.
	 *
	 * <p><strong>Anchored on the subscription's creation, not on the window being replaced.</strong> Rolling
	 * from the stored start would re-anchor on whatever the last roll clamped to — an account provisioned on
	 * the 31st gets February the 28th, and every window after that is a 28th — so the reset date a user plans
	 * around walks earlier and never comes back. From the anchor it clamps for February and returns to the 31st
	 * in March, which is what {@code plusMonths} does and the reason #20 counts months rather than 30 days.
	 *
	 * <p>Whole months at once rather than a month at a time: an account that has not signed in since April is
	 * one statement, not five, and the answer does not depend on how long the user was away.
	 *
	 * <p>Idempotent, and it has to be. Two of the same user's calls can arrive with the window already closed;
	 * the second waits on the {@code for update} above, then computes the same two values from the same anchor
	 * and writes them again.
	 */
	private Subscription rolledForward(Row row, OffsetDateTime now) {
		QuotaPeriod rolled = ourOwnWindowAt(row.createdAt(), now);
		this.db.sql("update subscription set period_start = ?, period_end = ? where id = ?")
				.params(rolled.start(), rolled.end(), row.id())
				.update();
		return new Subscription(row.tier(), row.status(), rolled);
	}

	/**
	 * The whole calendar month of this subscription's own window that contains {@code now}, counted from the
	 * anchor — the arithmetic above, in one place because ADR-0018's fallback needs exactly the same answer:
	 * a subscription Stripe has finished with goes back onto the roll it would have been on had it never been
	 * bought, rather than onto a window starting the moment it was cancelled.
	 */
	private static QuotaPeriod ourOwnWindowAt(OffsetDateTime anchor, OffsetDateTime now) {
		long wholeMonths = ChronoUnit.MONTHS.between(anchor, now);
		return new QuotaPeriod(anchor.plusMonths(wholeMonths), anchor.plusMonths(wholeMonths + 1));
	}

	// --- the Stripe mirror (#30, T20) ---------------------------------------------------------------------

	/**
	 * One {@code update} of seven columns, and the two ids are written every time rather than only when they
	 * change: an event that reached this row through the tag alone is how a Checkout's customer id gets stored
	 * in the first place, and Stripe's answer is the authority on both of them anyway.
	 */
	@Override
	@Transactional
	public Mirroring mirror(SubscriberOnStripe who, SubscriptionStatus status, String stripePriceId,
			QuotaPeriod period, OffsetDateTime saidAt) {
		Optional<Mirrored> row = theRowBehind(who);
		if (row.isEmpty()) {
			return Mirroring.NOBODY_HERE_IS_BILLED_AS_THAT;
		}
		if (row.get().hasHeardNewer(saidAt)) {
			return Mirroring.SAID_BEFORE_WHAT_IS_ALREADY_MIRRORED;
		}
		// Read before the write and reported rather than thrown: a Price belonging to no tier is a Stripe
		// account holding something we do not sell, which is ADR-0019's ordinary case and not a fault of this
		// subscriber's. The row keeps whatever tier it was on, which for a renewal is the right one already.
		Optional<TierId> tier = this.tiers.tierSoldAs(stripePriceId);
		if (tier.isEmpty()) {
			return Mirroring.NO_TIER_SELLS_THAT_PRICE;
		}
		this.db.sql("""
				update subscription
				   set tier_id = ?, status = ?, period_start = ?, period_end = ?,
				       stripe_customer_id = ?, stripe_subscription_id = ?, mirrored_through = ?
				 where id = ?
				""")
				.params(tier.get().id(), stored(status), period.start(), period.end(), who.customerId(),
						who.subscriptionId(), saidAt, row.get().id())
				.update();
		return Mirroring.MIRRORED;
	}

	/**
	 * ADR-0018, as one statement: the default tier, {@code active}, our own window back, the subscription id
	 * gone and the customer id kept.
	 *
	 * <p>The window is computed from the anchor rather than from now, so somebody who cancels three months in
	 * lands on the window they would have been on had they never bought anything — and {@code resetAt} keeps
	 * the date they have been planning around instead of jumping to today.
	 *
	 * <p>{@code stripe_subscription_id} is set to null rather than left, and that is what makes the window
	 * ours to roll again ({@link Row#windowIsOursToRoll()}). Left behind, this account's window would sit
	 * where the cancellation put it for ever, since the Stripe subscription that owned it no longer exists to
	 * send another event.
	 */
	@Override
	@Transactional
	public Mirroring ended(SubscriberOnStripe who, OffsetDateTime saidAt) {
		Optional<Mirrored> row = theRowBehind(who);
		if (row.isEmpty()) {
			return Mirroring.NOBODY_HERE_IS_BILLED_AS_THAT;
		}
		if (row.get().hasHeardNewer(saidAt)) {
			return Mirroring.SAID_BEFORE_WHAT_IS_ALREADY_MIRRORED;
		}
		QuotaPeriod ours = ourOwnWindowAt(row.get().createdAt(), OffsetDateTime.now(ZoneOffset.UTC));
		this.db.sql("""
				update subscription
				   set tier_id = ?, status = 'active', period_start = ?, period_end = ?,
				       stripe_customer_id = ?, stripe_subscription_id = null, mirrored_through = ?
				 where id = ?
				""")
				.params(this.tiers.defaultTier().id(), ours.start(), ours.end(), who.customerId(), saidAt,
						row.get().id())
				.update();
		return Mirroring.FELL_BACK_TO_THE_DEFAULT_TIER;
	}

	/**
	 * The subscription an event is about, locked for the rest of the transaction — by our own tag, or by the
	 * customer Stripe says is paying.
	 *
	 * <p><strong>Two ways in and not three.</strong> The subscription id would be a third, and it would never
	 * be the one that answered: this class writes both Stripe ids in the same statement, so a row that knows a
	 * subscription knows its customer too, and the clause could only ever repeat what the customer already
	 * said. It is left out rather than kept as a line no test could tell the difference about — which is the
	 * precedent {@code TierRows.published()} set for exactly this.
	 *
	 * <p>The tag wins where both match, so that the answer is a decision rather than whichever row Postgres
	 * reached first. Spelled as a {@code case} rather than an {@code order by … desc} because a comparison
	 * against a null parameter is null rather than false, and nulls sort first in a descending order.
	 *
	 * <p>{@code for update} for {@link #currentFor}'s reason turned around: this is the write, and a relist
	 * being authorized against the row at the same moment must see either the old plan or the new one rather
	 * than a quota counted in one window and a tier from the other.
	 */
	private Optional<Mirrored> theRowBehind(SubscriberOnStripe who) {
		return this.db.sql("""
				select id, created_at, mirrored_through
				  from subscription
				 where app_user_id = :account
				    or stripe_customer_id = :customer
				 order by case when app_user_id = :account then 0 else 1 end
				 limit 1
				 for update
				""")
				.param("account", who.taggedAccount().orElse(null))
				.param("customer", who.customerId())
				.query((values, number) -> new Mirrored(values.getObject("id", UUID.class),
						utc(values.getObject("created_at", OffsetDateTime.class)),
						optionalUtc(values.getObject("mirrored_through", OffsetDateTime.class))))
				.optional();
	}

	/**
	 * A subscription as the mirror needs it: which row, what its window is anchored on, and how far through
	 * Stripe's telling it already is.
	 *
	 * @param mirroredThrough the {@code created} of the newest Stripe event applied here, or null where none
	 * ever has been — which is every account that has not paid
	 */
	private record Mirrored(UUID id, OffsetDateTime createdAt, OffsetDateTime mirroredThrough) {

		/**
		 * Whether this row already reflects something Stripe said after the event now in hand — which makes
		 * that event a redelivery, or a retry that overtook its own successor, and either way nothing to apply.
		 *
		 * <p>Strictly after, so an event stamped in the same second as the last one is applied. Stripe's
		 * timestamps are whole seconds and a Checkout generates {@code customer.subscription.created} and
		 * {@code .updated} inside one of them; refusing an equal timestamp would drop the second of that pair
		 * and leave a paid-up subscriber on whatever the first one said.
		 */
		boolean hasHeardNewer(OffsetDateTime saidAt) {
			return this.mirroredThrough != null && this.mirroredThrough.isAfter(saidAt);
		}

	}

	/**
	 * A row as it is stored, including the two things nobody outside this module may see: which subscription it
	 * is, and whether Stripe owns its window.
	 *
	 * @param stripes whether a Stripe subscription is mirrored here, which is what makes the window Stripe's to
	 * move. Free subscriptions have no Stripe counterpart at all, so theirs is ours to roll
	 */
	private record Row(UUID id, TierId tier, SubscriptionStatus status, QuotaPeriod period,
			OffsetDateTime createdAt, boolean stripes) {

		/**
		 * Whether a closed window here is ours to advance. A free subscription's is, and is the case #20 left
		 * open. A payer's is <strong>not</strong>: theirs is copied from Stripe's own billing period (#30), so a
		 * closed one means a webhook has not arrived yet, and rolling it would invent a period Stripe did not
		 * grant — a month's quota handed to an annual plan every month, and to a lapsed payer whose next
		 * webhook says {@code past_due}. Since #30 rows do carry one, and the flag turns itself off again
		 * exactly where ADR-0018 says it should: a subscription Stripe has finished with has its id cleared,
		 * which is what hands the window back to the roll below.
		 */
		boolean windowIsOursToRoll() {
			return !this.stripes;
		}

		Subscription asSeenByOthers() {
			return new Subscription(this.tier, this.status, this.period);
		}

	}

	/**
	 * The column's spelling, which is Stripe's: seven lower-case names a check constraint holds the column to.
	 * This is the whole of the mapping, and it is in {@code internal} because how a status is spelled in a
	 * column is the adapter's business — {@code SubscriptionStatus} is what the rest of the application reads.
	 */
	private static SubscriptionStatus statusIn(String stored) {
		try {
			return SubscriptionStatus.valueOf(stored.toUpperCase(Locale.ROOT));
		}
		catch (IllegalArgumentException outsideTheSeven) {
			throw new IllegalStateException("The subscription status '" + stored + "' is not one of the seven "
					+ "SubscriptionStatus names, so either subscription_status_check has been widened without "
					+ "this enum or the row was written around it", outsideTheSeven);
		}
	}

	/**
	 * The other direction of {@link #statusIn(String)}: how the column spells what this enum names. Here for
	 * the same reason that one is — the spelling is the adapter's business — and beside it, so that a status
	 * written one way and read another is a thing two adjacent methods would have to disagree about.
	 */
	private static String stored(SubscriptionStatus status) {
		return status.name().toLowerCase(Locale.ROOT);
	}

	/**
	 * Every window bound in one offset, because the driver hands back {@code timestamptz} in the JVM's own and
	 * a month of calendar arithmetic in a zone that observes summer time is a month that starts an hour early.
	 * #20 writes these in UTC; this reads them the same way round.
	 */
	private static OffsetDateTime utc(OffsetDateTime stored) {
		return stored.withOffsetSameInstant(ZoneOffset.UTC);
	}

	/** The same, for a column that is null until Stripe has said something about the row (#30). */
	private static OffsetDateTime optionalUtc(OffsetDateTime stored) {
		return stored == null ? null : utc(stored);
	}

	private final JdbcClient db;

	private final TierCatalog tiers;

}
