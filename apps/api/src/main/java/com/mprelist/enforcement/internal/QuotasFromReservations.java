package com.mprelist.enforcement.internal;

import org.springframework.stereotype.Service;

import com.mprelist.catalog.Entitlement;
import com.mprelist.catalog.TierCatalog;
import com.mprelist.enforcement.Quotas;
import com.mprelist.enforcement.RemainingQuota;
import com.mprelist.identity.UserRef;
import com.mprelist.subscription.Subscription;

/**
 * The walk behind {@link Quotas}: the tier's grant from {@code catalog}, the units held from this module's own
 * {@code usage_reservation}, and the subtraction between them.
 *
 * <p><strong>The walk is here because three callers take it.</strong> {@link RelistGate} refuses on it,
 * {@link RelistReports} answers with it and {@code display}'s {@code /api/me} renders it — three readers of
 * one number, which is three chances for the popup to show "1 relist left" beside a button the gate refuses.
 * {@link RemainingQuota} made the subtraction one; this makes the two reads that feed it one as well, so a
 * later reader cannot count a tier's grant against a window somebody else's arithmetic chose.
 *
 * <p>Named for where the count comes from rather than for the question, which is {@link Quotas}' — the
 * interface is what another module holds, and this is the reservations answering it.
 */
@Service
class QuotasFromReservations implements Quotas {

	QuotasFromReservations(TierCatalog tiers, UsageReservations reservations) {
		this.tiers = tiers;
		this.reservations = reservations;
	}

	/**
	 * <strong>An unlimited tier skips the count</strong> (ADR-0029). {@link RemainingQuota#of} ignores
	 * {@code held} when the grant is {@code null}, so the statement behind it would be a scan of this
	 * period's reservations for a number nothing reads — on the gate's own path, for the users doing the
	 * highest volume. Skipped here rather than inside the record, because this is the class that knows what
	 * asking costs.
	 */
	@Override
	public RemainingQuota leftFor(UserRef caller, Subscription plan) {
		Entitlement granted = this.tiers.entitlementOf(plan.tier());
		int held = granted.relistsPerPeriod() == null ? 0
				: this.reservations.unitsHeldIn(caller, plan.period());
		return RemainingQuota.of(granted, held, plan.period());
	}

	private final TierCatalog tiers;

	private final UsageReservations reservations;

}
