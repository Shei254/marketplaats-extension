package com.mprelist.enforcement.internal;

import org.springframework.stereotype.Service;

import com.mprelist.catalog.TierCatalog;
import com.mprelist.identity.UserRef;
import com.mprelist.subscription.Subscription;

/**
 * What a subscriber has left of the period they are in: their tier's grant, less the units that period is
 * already holding (ADR-0007).
 *
 * <p><strong>The walk is here because both ends of the gate take it.</strong> {@link RelistGate} refuses on it
 * and {@link RelistReports} answers with it, and #26's {@code /api/me} will render it — three readers of one
 * number, which is three chances for the popup to show "1 relist left" beside a button the gate refuses.
 * {@link RemainingQuota} made the subtraction one; this makes the two reads that feed it one as well, so a
 * later reader cannot count a tier's grant against a window somebody else's arithmetic chose.
 *
 * <p>Takes the {@link Subscription} rather than reading it, because both callers have already read it — the
 * gate to check the status it grants on, the report to hold the row for the length of its transaction — and a
 * second {@code currentFor} here would be a second lock and a second chance to roll a window.
 */
@Service
class Quotas {

	Quotas(TierCatalog tiers, UsageReservations reservations) {
		this.tiers = tiers;
		this.reservations = reservations;
	}

	/**
	 * The tier's grant less what the window holds, clamped by {@link RemainingQuota}.
	 *
	 * <p>Usage is what is <em>held</em> in this period, so a relist still in flight already counts: the
	 * extension is between the delete and the create and the unit is spent until it says otherwise (#23). The
	 * entitlement is resolved from the plan's tier rather than from the caller, which is why neither
	 * {@code subscription} nor {@code catalog} has to know what a quota check is.
	 *
	 * @param plan the caller's subscription as the transaction has already read it, whose {@code period} is
	 * both the window counted in and the {@code resetAt} answered with
	 */
	RemainingQuota leftFor(UserRef caller, Subscription plan) {
		return RemainingQuota.of(this.tiers.entitlementOf(plan.tier()),
				this.reservations.unitsHeldIn(caller, plan.period()), plan.period());
	}

	private final TierCatalog tiers;

	private final UsageReservations reservations;

}
