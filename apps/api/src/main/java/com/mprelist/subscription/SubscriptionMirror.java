package com.mprelist.subscription;

import java.time.OffsetDateTime;

/**
 * Where Stripe's view of a subscription becomes ours (#30, T20) — the write half of this module, kept apart
 * from {@link Subscriptions} for the reason {@code PriceAdoptions} is kept apart from {@code TierCatalog}:
 * one is read by the gate on every relist and this is written to by a webhook, and a reader that could also
 * write is a reader that eventually does.
 *
 * <p><strong>What crosses this boundary is our own vocabulary and Stripe's identifiers, never a Stripe
 * type.</strong> {@code billing} is the only module that has heard of that library (ADR-0012), and what it
 * hands over here is a normalized {@link SubscriptionStatus}, a {@link QuotaPeriod}, a Price id and the three
 * ids on {@link SubscriberOnStripe}. Which tier that Price belongs to, whether the event is worth applying at
 * all, and what a subscription's end does to a row are all decided on this side, because all three are
 * statements about our own table.
 *
 * <p><strong>Whose row it is: our own tag, or the customer.</strong> The tag was written by the Checkout
 * session that created the subscription and names an account directly, so it is asked first and is what makes
 * a purchase land whichever order Stripe delivers its events in. The customer id is the fallback and is ours
 * only once an earlier event stored it, which is what finds a subscription somebody made in the Stripe
 * dashboard for a customer we already know. An event matching neither is
 * {@link Mirroring#NOBODY_HERE_IS_BILLED_AS_THAT} and changes nothing: one Stripe account can serve more than
 * one deployment, and guessing would move a stranger's plan.
 *
 * <p><strong>Order and repetition are handled here rather than asked of the caller.</strong> Stripe delivers
 * at least once and in no guaranteed order, so both methods take the moment Stripe said it and apply nothing
 * that has already been overtaken — see {@code V6__subscription_mirror.sql}. That makes a redelivery a no-op
 * and a late retry harmless, which is what {@code idempotent on the event id} was asking for and one column
 * rather than a table of ids: the mirror is a statement of the current state, so applying the newest one
 * twice writes the same row twice.
 */
public interface SubscriptionMirror {

	/**
	 * Stripe reports a subscription that exists: live, in a trial, or in dunning with the card still being
	 * retried. The tier, the status and the window all become what Stripe says they are.
	 *
	 * <p><strong>Dunning keeps the paid tier</strong> (ADR-0018): {@code past_due}, {@code unpaid} and
	 * {@code incomplete} are mirrored as they are, so the subscriber stays on the plan they bought and is
	 * refused by {@code SUBSCRIPTION_INACTIVE} until the retry succeeds and gives it straight back. Taking the
	 * tier away mid-retry would take away something the next event returns.
	 *
	 * <p><strong>The window is Stripe's from here on.</strong> {@link Subscriptions#currentFor} rolls a free
	 * window that has closed and never a mirrored one, so a period that ends is one this method has to move —
	 * a closed Stripe window means a webhook has not arrived yet, and inventing the next one would grant a
	 * month nobody was billed for.
	 *
	 * @param who which subscription, and whose
	 * @param status Stripe's status, normalized to the seven this application stores
	 * @param stripePriceId the Price the subscription is for, which is what names the tier. A Price no tier
	 * carries grants nothing and leaves the row alone
	 * @param period Stripe's current billing period, copied whole — it is what {@code resetAt} answers with
	 * @param saidAt the moment Stripe generated the event, which is what orders it against what is already
	 * mirrored
	 * @return which of the five things happened, for the caller that logs it
	 */
	Mirroring mirror(SubscriberOnStripe who, SubscriptionStatus status, String stripePriceId, QuotaPeriod period,
			OffsetDateTime saidAt);

	/**
	 * Stripe reports that the subscription is over and it is not going to retry — {@code canceled} or
	 * {@code incomplete_expired}, which is what {@link SubscriptionStatus#endsTheSubscription()} names.
	 *
	 * <p>The subscriber becomes a free user again rather than a lapsed one (ADR-0018): the default tier,
	 * {@code active}, and the window back on the monthly roll anchored on when the account was provisioned.
	 * The alternative — mirroring {@code canceled} onto a row still pointing at Pro — leaves somebody who paid
	 * for three months with strictly less than a stranger who never paid, since the gate checks status before
	 * quota and would deny every relist for ever.
	 *
	 * <p>The customer id is <strong>kept</strong> and the subscription id <strong>cleared</strong>, which is
	 * the pairing that makes resubscribing one billing history rather than two: {@code OpenCheckout} passes
	 * that customer back to Stripe, and the Portal (T21, #31) points at the half our row still names.
	 *
	 * <p>Takes no tier and no period, and that is deliberate rather than an omission. Neither is needed to end
	 * something, and requiring them would make a cancellation depend on reading two fields that could be
	 * absent — leaving the one event that must always land as the one that could fail to.
	 *
	 * @param who which subscription, and whose
	 * @param saidAt the moment Stripe generated the event
	 * @return {@link Mirroring#FELL_BACK_TO_THE_DEFAULT_TIER}, or why it did not
	 */
	Mirroring ended(SubscriberOnStripe who, OffsetDateTime saidAt);

}
