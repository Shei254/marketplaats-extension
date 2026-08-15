package com.mprelist.subscription;

import com.mprelist.identity.UserRef;

/**
 * What this module answers about a user's plan: the mirror of Stripe's status and period, read from our own
 * table and never from Stripe on the way (ADR-0006, ADR-0007) — a network hop to a payment provider between a
 * user and their own quota is exactly what the mirror exists to avoid.
 *
 * <p>An interface with its implementation in {@code internal} for the reason {@code TierCatalog} is one:
 * {@code enforcement} should be able to ask which tier somebody is on and when their period ends without also
 * being able to see the {@code subscription} table, the Stripe ids on it, or the SQL that reads them.
 */
public interface Subscriptions {

	/**
	 * The caller's subscription, in the period that is current <em>now</em>.
	 *
	 * <p>Two things happen here that a plain read would not do, and both are this module's business rather than
	 * the gate's:
	 *
	 * <ul>
	 * <li><strong>A free window that has closed is rolled forward</strong> before it is answered with. ADR-0014
	 * has a free subscription's window roll monthly from provisioning, and #20 writes only the first one, so
	 * from a free account's second month the stored {@code period_end} sits in the past. Rolled here because
	 * this is the only code that reads the window, and a caller that had to notice a closed one would be a
	 * caller that can forget to. A window Stripe owns is <strong>not</strong> rolled — see below.</li>
	 * <li><strong>The row is locked for the calling transaction.</strong> The reader is a gate that checks a
	 * quota and then spends against it (#22), and a check-then-write is only atomic if something serialises two
	 * of them: this is that something, and it is one row per user, so it costs nothing to anybody but the same
	 * user's second concurrent call. It follows that a caller wanting the answer to outlive its transaction has
	 * to be in one — which the gate is, because it writes.</li>
	 * </ul>
	 *
	 * <p><strong>Nobody is without one.</strong> First login provisions an account and its subscription in one
	 * transaction (#20, ADR-0014), and a {@link UserRef} cannot be held for an account that does not exist, so
	 * this throws rather than answering an empty {@link java.util.Optional} — like {@code TierCatalog} and for
	 * the same reason. The empty answer would reach a gate that fails closed, which would deny that caller with
	 * {@code QUOTA_EXCEEDED}: indistinguishable from an ordinary exhausted user, which is how a broken invariant
	 * comes to look like the product working.
	 *
	 * @param user the account to answer about
	 * @throws IllegalStateException if that account holds no subscription
	 */
	Subscription currentFor(UserRef user);

}
