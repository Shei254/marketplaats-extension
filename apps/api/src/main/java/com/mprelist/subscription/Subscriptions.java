package com.mprelist.subscription;

import java.util.Optional;

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
	 * <li><strong>A window Stripe owns is answered a month at a time</strong> (T87, ADR-0037): the month of it
	 * that contains now, counted from its start. An annual price buys the monthly grant twelve times, so the
	 * period answered here is a month even while the row holds Stripe's year.</li>
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

	/**
	 * The Stripe customer this account has been billed as, if it ever has been (T19, #29).
	 *
	 * <p>A second question rather than a field on {@link Subscription}, because that record is read on the
	 * authorize path by a gate that checks a quota — and a Stripe id travelling on the hot path is a column a
	 * later reader could come to branch on. This one is asked by {@code billing}, once, when somebody is about
	 * to be sent to Checkout.
	 *
	 * <p><strong>What it is for is not creating a second customer.</strong> ADR-0018 has a cancelled
	 * subscriber fall back to the free tier with {@code stripe_customer_id} <em>kept</em> and
	 * {@code stripe_subscription_id} cleared, precisely so that resubscribing is the same customer buying
	 * again rather than a stranger with the same email. Opening a Checkout session without this would split
	 * one person's billing history in two and leave the Customer Portal (T21, #31) pointing at whichever half
	 * our row happened to name.
	 *
	 * @param user the account to answer about
	 * @return the customer id, or nothing for an account that has never paid — which is every free user, and
	 * is not a fault
	 */
	Optional<String> stripeCustomerFor(UserRef user);

	/**
	 * Whether Stripe is billing this account right now — the {@code paying} half of {@link SubscriberCount},
	 * asked about one account rather than counted over a tier (T83).
	 *
	 * <p><strong>True through dunning, false after a terminal end.</strong> A card being retried is still a
	 * subscription Stripe expects to charge, and a successful retry gives the tier straight back; a cancellation
	 * clears the Stripe subscription and keeps the customer (ADR-0018), so a returning subscriber is not paying
	 * and may buy again as themselves. The status is therefore not what is asked: whether a Stripe subscription
	 * exists at all is.
	 *
	 * <p>A boolean rather than the id, for {@link Subscription}'s reason: the id is this module's, and the one
	 * caller — {@code billing}, about to open a Checkout — needs to know only whether a second one would be a
	 * second charge.
	 *
	 * @param user the account to answer about
	 * @return whether Stripe holds a live subscription for it, and {@code false} for an account with no row
	 */
	boolean isPaying(UserRef user);

	/**
	 * The Stripe subscription billing this account, for the one thing that has to name it: a <strong>Plan
	 * switch</strong>, which changes the Price on it in place rather than opening a second (T85, ADR-0036).
	 *
	 * @param user the account to answer about
	 * @return its live subscription's id, or nothing where Stripe is billing it for nothing
	 */
	Optional<String> stripeSubscriptionFor(UserRef user);

	/**
	 * The Stripe Price that subscription is billed at, as the last mirrored event said (T85). What the site
	 * reads a paying subscriber's <strong>Rhythm</strong> from, so their own card can offer the other.
	 *
	 * @param user the account to answer about
	 * @return the Price id, or nothing where nobody is paying — or where a subscriber from before T85 has had
	 * no event since, which is "rhythm unknown" rather than an error
	 */
	Optional<String> stripePriceFor(UserRef user);

}
