package com.mprelist.display.internal;

import java.util.Optional;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.mprelist.catalog.Entitlement;
import com.mprelist.catalog.TierCatalog;
import com.mprelist.catalog.TierId;
import com.mprelist.catalog.TierPrice;
import com.mprelist.enforcement.Quotas;
import com.mprelist.enforcement.RemainingQuota;
import com.mprelist.identity.UserRef;
import com.mprelist.subscription.Subscription;
import com.mprelist.subscription.Subscriptions;

/**
 * What the caller is shown: their plan as {@code subscription} holds it, what that tier is called and grants
 * as {@code catalog} answers, and what the period has left as {@code enforcement} counts it.
 *
 * <p><strong>Four modules and one decision, which used to be none.</strong> Every value here is somebody
 * else's answer, asked in the one order that keeps them consistent, and nothing is computed on the way —
 * which is the difference between this and the gate. The decision T77 added is not arithmetic either: a
 * subscription that names no tier has nothing for the three reads below to be about, and this is where that
 * is noticed rather than where a {@code null} would be rendered as a plan with holes in it. A display that
 * did arithmetic of its own would be a second opinion about a quota, and the popup showing "1 relist left"
 * beside a button the gate refuses is exactly the bug {@link RemainingQuota} exists to make unreachable.
 *
 * <p><strong>Transactional, though it grants nothing.</strong> {@code Subscriptions.currentFor} is
 * {@code MANDATORY} — it locks the caller's row and rolls a free window that has closed, and both are only
 * meaningful inside a transaction. Rolling is a write and it is wanted here: this is the call both clients
 * make immediately after signing in, so a free user whose month turned over sees the window they are actually
 * in rather than a {@code resetAt} in the past and a quota counted in a period that ended. The lock is that
 * one user's own row and is held for the length of a call that reads three tables and writes at most two
 * columns, so the only caller it can ever delay is the same user's own relist.
 *
 * <p>The tier is asked twice, for its name and for what it grants, and that is two statements against one row
 * rather than one. It keeps {@code entitlementOf} — which the gate calls on the authorize path — reading only
 * the columns a check is made of, and this is the display path: the count of statements it costs is a price
 * paid where nobody is waiting on a relist. The entitlement is read <em>once</em> and asked twice, since #41
 * needs what the tier grants as well as its flags and a second call would be a second chance for the two to
 * disagree.
 */
@Service
class DisplayStates {

	DisplayStates(Subscriptions subscriptions, TierCatalog tiers, Quotas quotas) {
		this.subscriptions = subscriptions;
		this.tiers = tiers;
		this.quotas = quotas;
	}

	/**
	 * The snapshot, for the account the caller's token names.
	 *
	 * <p>Always about the caller and never about an account they name, which is what makes this unsigned
	 * answer safe to hand out: there is no parameter here for anybody to put somebody else's id in.
	 */
	@Transactional
	Shown forCaller(UserRef caller) {
		Subscription plan = this.subscriptions.currentFor(caller);
		// Before the quota and before either read of the tier, because all three are questions about a tier
		// and this caller is on none (T77, ADR-0032). Their status is still perfectly true and is deliberately
		// not shown alone: a body carrying `subscriptionStatus` and four nulls is a plan with holes in it,
		// and the holes are the numbers.
		Optional<TierId> tier = plan.tier();
		if (tier.isEmpty()) {
			return new Shown.NoTier();
		}
		RemainingQuota left = this.quotas.leftFor(caller, plan);
		Entitlement granted = this.tiers.entitlementOf(tier.get());
		boolean paying = this.subscriptions.isPaying(caller);
		String rhythm = paying ? this.subscriptions.stripePriceFor(caller).flatMap(this::rhythmSoldAs).orElse(null)
				: null;
		return new Shown.Plan(new DisplayState(plan.status(), this.tiers.nameOf(tier.get()),
				left.quotaRemaining(), granted.relistsPerPeriod(), left.resetAt(), granted.features(), paying,
				rhythm));
	}

	/**
	 * The Rhythm a Price is sold at, read off the cards on sale. A Price no published tier sells — a plan taken
	 * off sale, or repriced since — has no card to offer the other rhythm on, so "unknown" costs nothing.
	 */
	private Optional<String> rhythmSoldAs(String stripePriceId) {
		return this.tiers.published().stream()
				.flatMap(plan -> plan.prices().stream())
				.filter(price -> price.stripePriceId().equals(stripePriceId))
				.map(TierPrice::interval)
				.findFirst();
	}

	private final Subscriptions subscriptions;

	private final TierCatalog tiers;

	private final Quotas quotas;

}
