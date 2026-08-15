package com.mprelist.subscription;

import com.mprelist.catalog.TierId;

/**
 * A user's current plan, as the rest of the application is allowed to know it: which tier they are on, whether
 * that tier entitles them to anything today, and the window their usage is counted in.
 *
 * <p>Three of the {@code subscription} row's columns and not the others, which is the point of the record
 * rather than a row. {@code stripe_customer_id} and {@code stripe_subscription_id} stay inside this module —
 * they are what makes Stripe a replaceable adapter (ADR-0012), and a gate that could see them is a gate that
 * could come to branch on whether somebody is paying. {@code app_user_id} is not here either: it is what the
 * caller asked about.
 *
 * <p><strong>The tier is a reference, not a grant.</strong> What being on it entitles the holder to is
 * {@code catalog}'s to answer — {@code TierCatalog.entitlementOf(tier)} — which is the seam that keeps this
 * module out of the {@code tier} table and #22's gate is where the two meet.
 *
 * @param tier the tier this subscription is on, as the {@code tier_id} foreign key names it
 * @param status Stripe's status, normalized. {@link SubscriptionStatus#allowsRelisting()} is what the gate asks
 * of it; every user always has a subscription (ADR-0014), so a free user is {@link SubscriptionStatus#ACTIVE}
 * here and is denied — if at all — by quota
 * @param period the quota window this subscription's usage is counted in. Copied from Stripe for a payer and
 * rolled monthly from provisioning for a free user, which is what makes it answerable for everybody
 */
public record Subscription(TierId tier, SubscriptionStatus status, QuotaPeriod period) {

	/**
	 * The check constraints of {@code V1__baseline_schema.sql}, restated where a subscription is built rather
	 * than only where a row is written — for {@link com.mprelist.catalog.Entitlement}'s reason: #22's tests
	 * stand these up with no database behind them. The window's own invariant is {@link QuotaPeriod}'s, so it
	 * holds wherever a period is assembled rather than only on the path through here.
	 */
	public Subscription {
		if (tier == null) {
			throw new IllegalArgumentException("A subscription names the tier it is on; tier_id is not null");
		}
		if (status == null) {
			throw new IllegalArgumentException("A subscription carries one of the seven normalized statuses");
		}
		if (period == null) {
			throw new IllegalArgumentException("A subscription carries the window its usage is counted in, so "
					+ "that resetAt is answerable for every user rather than only for payers");
		}
	}

}
