package com.mprelist.subscription.internal;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.mprelist.catalog.TierId;
import com.mprelist.identity.UserRef;
import com.mprelist.subscription.Subscription;
import com.mprelist.subscription.SubscriptionStatus;
import com.mprelist.subscription.Subscriptions;

/**
 * The {@code subscription} table as everything outside this module sees it, and the only code that reads it.
 *
 * <p>Plain SQL through {@link JdbcClient} for {@code TierRows}' reason: nothing here loads a subscription,
 * mutates it and writes it back, so an ORM would buy a persistence context this module has no use for. The one
 * write is the roll below, and it is an {@code update} of two columns.
 */
@Service
class SubscriptionRows implements Subscriptions {

	SubscriptionRows(JdbcClient db) {
		this.db = db;
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
						utc(values.getObject("period_start", OffsetDateTime.class)),
						utc(values.getObject("period_end", OffsetDateTime.class)),
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
		return row.windowIsOursToRoll() && !row.periodEnd().isAfter(now) ? rolledForward(row, now) : row.asSeenByOthers();
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
		long wholeMonths = ChronoUnit.MONTHS.between(row.createdAt(), now);
		OffsetDateTime start = row.createdAt().plusMonths(wholeMonths);
		OffsetDateTime end = row.createdAt().plusMonths(wholeMonths + 1);
		this.db.sql("update subscription set period_start = ?, period_end = ? where id = ?")
				.params(start, end, row.id())
				.update();
		return new Subscription(row.tier(), row.status(), start, end);
	}

	/**
	 * A row as it is stored, including the two things nobody outside this module may see: which subscription it
	 * is, and whether Stripe owns its window.
	 *
	 * @param stripes whether a Stripe subscription is mirrored here, which is what makes the window Stripe's to
	 * move. Free subscriptions have no Stripe counterpart at all, so theirs is ours to roll
	 */
	private record Row(UUID id, TierId tier, SubscriptionStatus status, OffsetDateTime periodStart,
			OffsetDateTime periodEnd, OffsetDateTime createdAt, boolean stripes) {

		/**
		 * Whether a closed window here is ours to advance. A free subscription's is, and is the case #20 left
		 * open. A payer's is <strong>not</strong>: theirs is copied from Stripe's own billing period (#30), so a
		 * closed one means a webhook has not arrived yet, and rolling it would invent a period Stripe did not
		 * grant — a month's quota handed to an annual plan every month, and to a lapsed payer whose next
		 * webhook says {@code past_due}. Nothing in the catalog is purchasable until #28 and #29, so no row can
		 * carry a Stripe subscription today; the branch is here because the answer is a decision rather than a
		 * thing to discover the first time somebody pays.
		 */
		boolean windowIsOursToRoll() {
			return !this.stripes;
		}

		Subscription asSeenByOthers() {
			return new Subscription(this.tier, this.status, this.periodStart, this.periodEnd);
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
	 * Every window bound in one offset, because the driver hands back {@code timestamptz} in the JVM's own and
	 * a month of calendar arithmetic in a zone that observes summer time is a month that starts an hour early.
	 * #20 writes these in UTC; this reads them the same way round.
	 */
	private static OffsetDateTime utc(OffsetDateTime stored) {
		return stored.withOffsetSameInstant(ZoneOffset.UTC);
	}

	private final JdbcClient db;

}
