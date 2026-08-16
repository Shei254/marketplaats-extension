package com.mprelist.enforcement;

import com.mprelist.identity.UserRef;
import com.mprelist.subscription.Subscription;

/**
 * What a subscriber has left of the period they are in: their tier's grant, less the units that period is
 * already holding (ADR-0007).
 *
 * <p><strong>The one question this module answers to anybody else</strong>, and the first thing it has ever
 * been asked from outside (ADR-0012). {@code usage_reservation} is this module's table and the unit held in a
 * period is counted nowhere else, so {@code display}'s {@code /api/me} either asks here or writes a second
 * count of its own — which is the disagreement {@link RemainingQuota} exists to make impossible, arriving by
 * a different route.
 *
 * <p>An interface with its implementation in {@code internal}, like {@code TierCatalog} and
 * {@code Subscriptions} and for their reason: a caller may ask what a period has left without also being able
 * to see the reservations, the statuses or the SQL that answer it.
 *
 * <p><strong>It answers about a plan the caller has already read, which is why it takes one.</strong> All
 * three readers hold a {@link Subscription} before they get here — the gate to check the status it grants on,
 * {@code /complete} to hold the row for the length of its transaction, {@code /api/me} to render the status
 * and the tier beside this number — and a read of its own here would be a second lock on the caller's row and
 * a second chance to roll a window that has closed. The window this counts in is then provably the window the
 * same answer's {@code resetAt} came from.
 */
public interface Quotas {

	/**
	 * The tier's grant less what the window holds, clamped by {@link RemainingQuota}.
	 *
	 * <p>Usage is what is <em>held</em> in this period, so a relist still in flight already counts: the
	 * extension is between the delete and the create and the unit is spent until it says otherwise (#23). The
	 * entitlement is resolved from the plan's tier rather than from the caller, which is why neither
	 * {@code subscription} nor {@code catalog} has to know what a quota check is.
	 *
	 * @param caller the account whose held units are counted
	 * @param plan the caller's subscription as the transaction has already read it, whose {@code period} is
	 * both the window counted in and the {@code resetAt} answered with
	 */
	RemainingQuota leftFor(UserRef caller, Subscription plan);

}
