package com.mprelist.enforcement.internal;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.mprelist.catalog.Entitlement;
import com.mprelist.catalog.TierCatalog;
import com.mprelist.enforcement.Quotas;
import com.mprelist.enforcement.RemainingQuota;
import com.mprelist.identity.UserRef;
import com.mprelist.subscription.Subscription;
import com.mprelist.subscription.Subscriptions;

/**
 * The gate of ADR-0007: whether this caller may relist this ad right now, and the unit of quota it costs them
 * if they may.
 *
 * <p>Three modules meet on this path and none of them can answer alone. {@code subscription} says which tier
 * somebody is on and when their period ends, {@code catalog} says what that tier grants, and the reservations
 * are this module's own — which is why the entitlement is resolved from a tier rather than from a user, and why
 * nothing in either of those modules knows what a quota check is. The last two meet in {@link Quotas}, which
 * {@code /complete} asks the same question of.
 *
 * <p>Since #147 the catalog is also asked here directly, and about a different half of what a tier grants: the
 * quota is a number to subtract from, {@code features.bulk} is a capability to have or not have. {@link Quotas}
 * is no place for that question — it answers about a period — so this is where the two halves of one
 * entitlement are read by the two checks that care about them.
 *
 * <p>The last check answers to none of them. {@link SafetyPolicy} asks about time rather than about
 * entitlement — how fast this account has been relisting, whatever it is paying (#25) — and reads only this
 * module's own table to answer.
 */
@Service
class RelistGate {

	RelistGate(Subscriptions subscriptions, TierCatalog tiers, Quotas quotas, SafetyPolicy safety,
			UsageReservations reservations, RelistAuthorizations authorizations) {
		this.subscriptions = subscriptions;
		this.tiers = tiers;
		this.quotas = quotas;
		this.safety = safety;
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
	 * @param batch whether the caller says this ad is one of several they are working through (#147). It is
	 * the only thing on this path that is about <em>what was asked for</em> rather than about the caller, and
	 * it is a claim rather than an observation — see {@link AuthorizeRequest#batch()}
	 * @return a signed authorization, or the refusal the extension renders
	 */
	@Transactional
	Verdict authorize(UserRef caller, AdId adId, boolean batch) {
		Subscription plan = this.subscriptions.currentFor(caller);
		if (!plan.status().allowsRelisting()) {
			return Verdict.Refused.because(ReasonCode.SUBSCRIPTION_INACTIVE);
		}
		// After the subscription status and before the quota, which is the contract's order and not an
		// implementation detail either (ADR-0025): a caller who named a capability their plan does not include
		// should not be answered about a quota it also does not include. Both refusals end at the plan screen
		// and only one of them describes what was asked for.
		//
		// The entitlement is resolved here and only when it is needed, so an ordinary single repost does
		// exactly the reads it did before this ticket. `Quotas` resolves it again a line below for the
		// subtraction it owns — a second primary-key lookup inside a transaction that is already holding this
		// caller's row, which is a cheaper thing than an interface widened so that two questions could share
		// one read and then have to be asked in the order that sharing implied.
		if (batch && !this.tiers.entitlementOf(plan.tier()).grants(Entitlement.BULK)) {
			return Verdict.Refused.because(ReasonCode.BULK_NOT_ENTITLED);
		}
		// Refused on the same arithmetic /complete answers with, and taken from the same place: the number the
		// popup renders as "1 left" and the number this refuses on are one subtraction over one pair of reads,
		// or they are two that can disagree — and the disagreement shows up as a locked button beside a quota
		// that says there is something in it.
		RemainingQuota left = this.quotas.leftFor(caller, plan);
		if (left.isSpent()) {
			return Verdict.Refused.untilTheQuotaComesBackAt(left.resetAt());
		}
		// The clock is read once, after the subscription: a window this call has just rolled starts at an
		// instant that cannot be later than this one, so the reservation below falls inside the period it was
		// counted against, and the token expires exactly when the row says it does. The pacing rail measures
		// from the same reading, so the row this call is about to write is stamped with the instant the next
		// call will pace itself from — two readings of a clock would let the interval between two relists come
		// out shorter than the one that was enforced.
		OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
		// Last, and after the quota rather than before it: a user with nothing left to spend is told that
		// rather than told to wait for a unit that is not coming back this period. Still before the
		// reservation, so a refusal does not cost the unit it refused to let them spend.
		Optional<Duration> wait = this.safety.waitRequiredOf(caller, now);
		if (wait.isPresent()) {
			return Verdict.Refused.untilTheyMayRelistAgainIn(wait.get());
		}
		OffsetDateTime expiresAt = now.plus(RelistAuthorizations.LIFETIME);
		UUID reservation = this.reservations.reserve(caller, adId, now, expiresAt);
		return this.authorizations.issue(caller, adId, reservation, expiresAt);
	}

	private final Subscriptions subscriptions;

	private final TierCatalog tiers;

	private final Quotas quotas;

	private final SafetyPolicy safety;

	private final UsageReservations reservations;

	private final RelistAuthorizations authorizations;

}
