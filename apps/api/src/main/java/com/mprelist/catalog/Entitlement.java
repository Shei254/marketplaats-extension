package com.mprelist.catalog;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * What a tier <em>grants</em>: relists per period, how many Marktplaats accounts may be associated, and the
 * feature flags that go with it. Resolved from our own {@code tier} table and never from Stripe (ADR-0014) —
 * Stripe owns what a plan costs, this owns what it lets its holder do, and #22's gate reads this on the
 * authorize path where a Stripe call would be a network hop between a user and their own quota.
 *
 * <p><strong>Limits, not a window and not a rate.</strong> The period a quota is counted in lives on the
 * subscription, because it is copied from Stripe's billing period for a payer and rolled monthly from
 * provisioning for a free user (ADR-0014) — two tiers are not two windows. And a number per period is not a
 * number per minute: a month's quota spent in one is exactly what #25's SafetyPolicy exists to refuse, so
 * nothing here paces anything.
 *
 * <p><strong>What a tier is called is not among these.</strong> {@code name} is display text an operator may
 * rewrite and {@code code} is the handle the seed upserts on; neither is something a caller is entitled
 * <em>to</em>. #26's {@code /api/me} renders a tier to a human and #43's plans page lists the catalog, so the
 * question "what is this tier called" arrives with the ticket that has somebody to show it to, on the same
 * interface this came in on.
 *
 * @param relistsPerPeriod what the quota check counts against, {@code tier.relist_quota_per_period}. Zero is
 * a coherent grant — a paused plan denies with {@code QUOTA_EXCEEDED} like any exhausted user, which is one
 * code path rather than a case of its own.
 * @param maxMarktplaatsAccounts how many Marktplaats accounts may be associated with the user,
 * {@code tier.max_marktplaats_accounts}. One on every tier in the catalog until #47 finds a stable Marktplaats
 * account identifier: until something can tell two of them apart, a tier promising three would be selling
 * something unobservable.
 * @param features the flags the tier carries, as the object {@code tier.features} holds rather than as a set
 * of names — a flag that later needs a value ("bulk, up to 20 at a time") then keeps its place. Empty on every
 * tier today, since the flags docs/domain-model.md names have no implementation behind them. Copied and
 * unmodifiable, so an entitlement cannot change under a reader already holding it. No {@code grants(flag)}
 * helper here on purpose: nothing reads a flag yet, and what a non-boolean value means to a reader is that
 * first reader's to decide rather than this record's to guess.
 */
public record Entitlement(int relistsPerPeriod, int maxMarktplaatsAccounts, Map<String, Object> features) {

	/**
	 * The check constraints of {@code V1__baseline_schema.sql}, stated a second time where an entitlement is
	 * built rather than only where a row is written. Every entitlement the catalog resolves comes off a row
	 * the database has already held to these, so the reason to repeat them is the ones that do not: a gate
	 * test standing an entitlement up without a catalog behind it should not be able to make one the table
	 * would have refused, since a quota below zero denies every relist and would read as a gate that works.
	 */
	public Entitlement {
		if (relistsPerPeriod < 0) {
			throw new IllegalArgumentException(
					"A tier granting fewer than no relists per period is not a smaller plan, it is a row "
							+ "tier_relist_quota_per_period_check would refuse: " + relistsPerPeriod);
		}
		if (maxMarktplaatsAccounts < 1) {
			throw new IllegalArgumentException(
					"A tier has to grant at least one Marktplaats account, or it denies every relist by "
							+ "arithmetic rather than by quota: " + maxMarktplaatsAccounts);
		}
		if (features == null) {
			throw new IllegalArgumentException("A tier granting no feature flags grants an empty set of them; "
					+ "tier.features is not null and defaults to {}");
		}
		// LinkedHashMap rather than Map.copyOf, which rejects a null value: `{"bulk": null}` is a flag an
		// operator can write into the column, and a catalog that threw on reading one would deny that tier's
		// subscribers their quota over a flag nothing reads. It arrives as the null it is stored as.
		features = Collections.unmodifiableMap(new LinkedHashMap<>(features));
	}

}
