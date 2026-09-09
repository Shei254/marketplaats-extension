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
 * number per minute: a month's quota spent in one is exactly what {@code enforcement}'s SafetyPolicy refuses
 * (#25), and its rails are one setting for everybody rather than a rung of this ladder — so nothing here
 * paces anything.
 *
 * <p><strong>What a tier is called is not among these.</strong> {@code name} is display text an operator may
 * rewrite and {@code code} is the handle the seed upserts on; neither is something a caller is entitled
 * <em>to</em>. #26's {@code /api/me} renders a tier to a human and #43's plans page lists the catalog, so the
 * question "what is this tier called" arrives with the ticket that has somebody to show it to, on the same
 * interface this came in on.
 *
 * @param relistsPerPeriod what the quota check counts against, {@code tier.relist_quota_per_period}. Zero is
 * a coherent grant — a paused plan denies with {@code QUOTA_EXCEEDED} like any exhausted user, which is one
 * code path rather than a case of its own. <strong>{@code null} is unlimited</strong> (ADR-0029), and the
 * component is boxed for exactly that: a {@code -1} sentinel would make {@code Math.max(0, -1 - held)} come
 * out {@code 0}, so the most generous tier in the catalog would refuse every repost while reading as a gate
 * that works. A {@code null} cannot be silently arithmetically wrong — the compiler names every reader
 * instead.
 * @param maxMarktplaatsAccounts how many Marktplaats accounts may be associated with the user,
 * {@code tier.max_marktplaats_accounts}. One on every tier in the catalog until #47 finds a stable Marktplaats
 * account identifier: until something can tell two of them apart, a tier promising three would be selling
 * something unobservable.
 * @param features the flags the tier carries, as the object {@code tier.features} holds rather than as a set
 * of names — a flag that later needs a value ("bulk, up to 20 at a time") then keeps its place, which since
 * {@code V8__seed_bulk_entitlement.sql} is not a hypothetical: {@code bulk} carries {@code {"upTo": N}}.
 * Copied and unmodifiable, so an entitlement cannot change under a reader already holding it.
 */
public record Entitlement(Integer relistsPerPeriod, int maxMarktplaatsAccounts, Map<String, Object> features) {

	/**
	 * Reposting several ads in one act (#147, ADR-0025) — the first flag anything has ever read, and the name
	 * is here rather than as a literal at the two ends because the seed writes it and the gate refuses on it.
	 * A third speller would be a tier that promises something nothing checks.
	 */
	public static final String BULK = "bulk";

	/**
	 * The check constraints of {@code V1__baseline_schema.sql}, stated a second time where an entitlement is
	 * built rather than only where a row is written. Every entitlement the catalog resolves comes off a row
	 * the database has already held to these, so the reason to repeat them is the ones that do not: a gate
	 * test standing an entitlement up without a catalog behind it should not be able to make one the table
	 * would have refused, since a quota below zero denies every relist and would read as a gate that works.
	 */
	public Entitlement {
		if (relistsPerPeriod != null && relistsPerPeriod < 0) {
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

	/**
	 * Whether this tier includes a named capability at all — <strong>whether, and never how much</strong>.
	 *
	 * <p>This record used to say it would not carry a helper like this, on the grounds that nothing read a
	 * flag yet and what a non-boolean value means was the first reader's to decide rather than this record's
	 * to guess. #147 is that first reader and this is that decision, written where the column is described
	 * rather than inside the gate, because the second reader ({@code scheduling}, when it is built) has to
	 * find the same rule rather than invent one beside it.
	 *
	 * <p><strong>The rule is: present, and not a value that says no.</strong> A JSON {@code null} is what an
	 * operator writes when they have named a flag and said nothing about it, and {@code false} is what they
	 * write to turn one off — neither is a grant. Everything else is, whatever shape it has, because the
	 * value belongs to whoever reads it: {@code bulk} carries {@code {"upTo": N}} and that number is the
	 * <em>popup's</em> cap on a selection (ADR-0025). This API sees one ad at a time and has nothing to count
	 * a batch with, so a method here that tried to answer "how many" would be answering a question the
	 * endpoint cannot ask.
	 *
	 * @param flag the capability's name, e.g. {@link #BULK}
	 */
	public boolean grants(String flag) {
		Object value = this.features.get(flag);
		return value != null && !Boolean.FALSE.equals(value);
	}

}
