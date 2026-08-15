package com.mprelist.enforcement.internal;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.mprelist.catalog.Entitlement;
import com.mprelist.catalog.TierCatalog;
import com.mprelist.identity.UserRef;
import com.mprelist.subscription.Subscription;
import com.mprelist.subscription.Subscriptions;

/**
 * The gate of ADR-0007: whether this caller may relist this ad right now, and the unit of quota it costs them
 * if they may.
 *
 * <p>Three modules meet here and none of them can answer alone. {@code subscription} says which tier somebody
 * is on and when their period ends, {@code catalog} says what that tier grants, and the reservations are this
 * module's own — which is why the entitlement is resolved from a tier rather than from a user, and why nothing
 * in either of those modules knows what a quota check is.
 */
@Service
class RelistGate {

	RelistGate(Subscriptions subscriptions, TierCatalog tiers, UsageReservations reservations,
			RelistAuthorizations authorizations) {
		this.subscriptions = subscriptions;
		this.tiers = tiers;
		this.reservations = reservations;
		this.authorizations = authorizations;
	}

	/**
	 * The checks, in the order {@code docs/enforcement-contract.md} fixes, first failure winning.
	 *
	 * <p><strong>The order is the contract and not an implementation detail.</strong> A lapsed payer who is also
	 * out of quota is told their subscription lapsed, because that is the one of the two they can do something
	 * about; the other way round they would be shown an upgrade prompt for a plan they are no longer paying for.
	 * The token was checked before any of this — the filter chain refuses a call carrying none, so a caller who
	 * reaches here is already named (#19), and asking for their {@link UserRef} is what has already provisioned
	 * the account and the subscription this reads (#20).
	 *
	 * <p><strong>Transactional, and it is load-bearing.</strong> {@code Subscriptions.currentFor} locks the
	 * subscription row for the length of this transaction, which is what makes reading a quota and then spending
	 * against it atomic: the same user's second concurrent call waits at that read and then counts the
	 * reservation the first one wrote. Without it, two callers holding one unit between them both count nothing
	 * spent and both spend it. The lock is per user, so it costs nobody else anything, and
	 * {@code currentFor} refuses to run outside a transaction rather than leaving that quietly true.
	 *
	 * @return a signed authorization, or the refusal the extension renders
	 */
	@Transactional
	Verdict authorize(UserRef caller, AdId adId) {
		Subscription plan = this.subscriptions.currentFor(caller);
		if (!plan.status().allowsRelisting()) {
			return Verdict.Refused.because(ReasonCode.SUBSCRIPTION_INACTIVE);
		}
		Entitlement granted = this.tiers.entitlementOf(plan.tier());
		// Usage is what is held in this period, so a relist still in flight already counts: the extension is
		// between the delete and the create and the unit is spent until it says otherwise (#23).
		//
		// Refused on the same arithmetic /complete answers with, rather than on a comparison of its own: the
		// number the popup renders as "1 left" and the number this refuses on are one subtraction, or they are
		// two that can disagree — and the disagreement shows up as a locked button beside a quota that says
		// there is something in it.
		RemainingQuota left = RemainingQuota.of(granted, this.reservations.unitsHeldIn(caller, plan.period()),
				plan.period());
		if (left.isSpent()) {
			return new Verdict.Refused(ReasonCode.QUOTA_EXCEEDED, left.resetAt());
		}
		// #25's SafetyPolicy check belongs here: after the quota, because a user who has nothing left to spend
		// should be told so rather than told to wait, and before the reservation, because a refusal must not
		// cost the unit it refused to let them spend.
		//
		// The clock is read once, after the subscription: a window this call has just rolled starts at an
		// instant that cannot be later than this one, so the reservation below falls inside the period it was
		// counted against, and the token expires exactly when the row says it does.
		OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
		OffsetDateTime expiresAt = now.plus(RelistAuthorizations.LIFETIME);
		UUID reservation = this.reservations.reserve(caller, adId, now, expiresAt);
		return this.authorizations.issue(caller, adId, reservation, expiresAt);
	}

	private final Subscriptions subscriptions;

	private final TierCatalog tiers;

	private final UsageReservations reservations;

	private final RelistAuthorizations authorizations;

}
