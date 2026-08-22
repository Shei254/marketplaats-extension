package com.mprelist.catalog;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * One tier as an <em>operator</em> sees it (T53, #84): everything about the row, including the parts nobody
 * else is shown.
 *
 * <p><strong>A fourth view of a tier, and the fourth is not a duplicate of the other three.</strong>
 * {@link Entitlement} is what a tier grants, {@link TierName} is what it is called and {@link SellablePlan}
 * is what a buyer could choose — each of them deliberately partial, because the gate must not read display
 * text and a plan card must not see a draft. This one is the whole row, and it exists because the person
 * looking at it is the person who decides what the other three will say.
 *
 * <p><strong>The two things an operator most needs to see are the two nobody else does.</strong> A draft —
 * quota 0, unpublished, created by the sync for a Price nobody had decided about (ADR-0019) — is invisible in
 * every other view by design, and it is the whole reason this one lists unpublished rows. And
 * {@code stripePriceId} is here as a fact to read rather than a field to edit: the Price is Stripe's and the
 * tag on it is what links the two (ADR-0019), so nobody types this id anywhere and it cannot drift.
 *
 * <p><strong>What a tier costs is not here</strong>, and that is the same split ADR-0014 makes everywhere
 * else: money is Stripe's. It matters more on this screen than on any other, because the admin list has to be
 * readable when Stripe is down — an operator whose catalog became uneditable during a Stripe outage would be
 * locked out of the one tool that could work around it.
 *
 * <p>{@code maxMarktplaatsAccounts} is absent too. Every tier grants one until #47 finds a stable Marktplaats
 * account identifier, so a column for it would be a form field for a constant.
 *
 * @param tier the pair every surface carries: the stable handle and the display text
 * @param relistQuotaPerPeriod what a period grants. **Zero is a coherent answer**, and on the default tier it
 * is how ADR-0019 says "there is no free tier" — every new user is still provisioned and every relist is
 * refused down the path that already works
 * @param features the flags as the {@code jsonb} column holds them, copied and unmodifiable
 * @param published whether a buyer may choose it. False on every draft, and on the free tier for good
 * @param isDefault whether new accounts are provisioned onto it. Exactly one tier carries it, which is an
 * invariant the schema holds ({@code tier_single_default}) and {@link TierEdits} preserves by only ever
 * moving it
 * @param stripePriceId the Price that sells it, or {@code null} — the free tier has none, and neither has a
 * tier whose Price has not been created in Stripe yet
 */
public record CatalogEntry(TierName tier, int relistQuotaPerPeriod, Map<String, Object> features,
		boolean published, boolean isDefault, String stripePriceId) {

	public CatalogEntry {
		if (tier == null) {
			throw new IllegalArgumentException("A catalog entry names its tier");
		}
		if (relistQuotaPerPeriod < 0) {
			throw new IllegalArgumentException("A tier granting fewer than no relists is a row "
					+ "tier_relist_quota_per_period_check would refuse: " + relistQuotaPerPeriod);
		}
		if (features == null) {
			throw new IllegalArgumentException("A tier granting no flags grants an empty set of them");
		}
		if (published && stripePriceId == null) {
			// V5__tier_publication.sql's own constraint, restated where an entry is built rather than only
			// where a row is written — for Entitlement's reason: a test standing one up by hand should not be
			// able to make a tier the table would have refused.
			throw new IllegalArgumentException("A published tier has something to charge against; "
					+ "tier_is_published_only_with_a_price refuses the row otherwise");
		}
		features = Collections.unmodifiableMap(new LinkedHashMap<>(features));
	}

}
