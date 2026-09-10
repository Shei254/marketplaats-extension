package com.mprelist.catalog;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The half of a tier an operator may change (T53, #84).
 *
 * <p><strong>What is missing from it is the decision.</strong> ADR-0019 splits a plan across two systems and
 * this type is where that split becomes visible to the person doing the work:
 *
 * <ul>
 * <li><strong>No amount and no interval.</strong> Stripe Prices are <em>immutable</em> — €9.99 does not become
 * €11.99, a new Price is created and the tier repointed, with existing subscribers left on the old one. A
 * field called "amount" here would be lying about what editing it does, which is the whole reason ADR-0019
 * rejected the form that creates Prices for you.
 * <li><strong>No {@code stripePriceId}.</strong> The link between the two systems is the {@code tier_code}
 * tag on the Price, written once in Stripe and read by the sync (T51, #82). An operator who could type the id
 * here would be typing it twice, and the second copy is the one that drifts.
 * <li><strong>No {@code isDefault}.</strong> It is not a property of one tier but of the catalog — exactly one
 * row carries it — so it moves rather than toggles, and {@link TierEdits#makeDefault(String)} is the whole of
 * how. A boolean here could be set to false on the only tier that has it, which takes down every new sign-in.
 * <li><strong>No {@code code}.</strong> It is the stable handle everything references (ADR-0014): the seed
 * upserts on it, the Price is tagged with it, and a subscription's tier is found through it. Renaming it would
 * silently unadopt the Price.
 * </ul>
 *
 * <p><strong>Whole rather than partial</strong>, which is why the route that takes one is a {@code PUT}: every
 * field is stated on every edit, and the form on the other side (T54, #85) is holding all four values anyway.
 *
 * <p><strong>One field answers "absent" and "null" differently, and it is the only one</strong> (ADR-0029).
 * That rule used to be stated as "so there is no 'absent or null' question to answer differently at each
 * reader", and it rested on {@code null} meaning <em>you forgot it</em>. Since a quota of {@code null} is how
 * unlimited is spelled, the two have to part: on the wire, leaving {@code relistQuotaPerPeriod} out is a
 * {@code 400} and sending it as an explicit JSON {@code null} is unlimited. The distinction lives at the wire
 * shape ({@code AdministerTiers.TierEditRequest}), not here — by the time an edit is one of these, the field
 * has been stated.
 *
 * @param name display text, an operator's to rewrite at any time (ADR-0014). Never compared, only rendered
 * @param relistQuotaPerPeriod what a period grants, or {@code null} for unlimited (ADR-0029). **Lowering it
 * under existing subscribers is allowed** and
 * is not a special case: what is left of a period is the grant minus what has been spent, clamped at zero
 * ({@code RemainingQuota}), so somebody who has already used more than the new number simply has none left
 * until it rolls. No proration and no notification (ADR-0014, amended)
 * @param features the flags, as the object the column holds. Empty is the ordinary case
 * @param published whether it may be bought. Publishing a tier with nothing to charge against is refused —
 * see {@link TierEdited.NothingToChargeAgainst} — and so is publishing one that grants nothing, see
 * {@link TierEdited.NothingToGrant}
 */
public record TierEdit(String name, Integer relistQuotaPerPeriod, Map<String, Object> features,
		boolean published) {

	public TierEdit {
		if (name == null || name.isBlank()) {
			// `tier.name` is not null, and a tier called nothing is one an operator cannot find again in
			// their own list. Blank is refused here rather than stored, unlike the read side — which renders
			// whatever is there rather than taking a subscriber's `/api/me` down over a label.
			throw new IllegalArgumentException("A tier carries display text; an empty name is not one");
		}
		if (relistQuotaPerPeriod != null && relistQuotaPerPeriod < 0) {
			throw new IllegalArgumentException("A tier granting fewer than no relists is a row "
					+ "tier_relist_quota_per_period_check would refuse: " + relistQuotaPerPeriod);
		}
		if (features == null) {
			throw new IllegalArgumentException("A tier granting no flags grants an empty set of them; "
					+ "tier.features is not null and defaults to {}");
		}
		name = name.strip();
		features = Collections.unmodifiableMap(new LinkedHashMap<>(features));
	}

	/**
	 * Whether a period on this tier grants no reposts at all (ADR-0029).
	 *
	 * <p><strong>Here because the publish rule has three layers and they must agree what "nothing" is.</strong>
	 * {@code CatalogEntry}'s constructor, {@code TierRows.applyEdit} and {@code CreatePlans.asGrant} each
	 * refuse a published tier that grants nothing, and each had written the comparison out for itself — in
	 * three spellings, one of them an unboxing {@code ==}. Three copies of one rule about one field is the
	 * set that drifts, and the way it drifts here is silent: every spelling agrees about {@code 0}, and the
	 * one that unboxes throws on unlimited instead of answering false.
	 *
	 * <p><strong>It is not the rule, only half of it.</strong> The rule is
	 * {@code published() && grantsNothing()} and is written that way at every site, because folding
	 * {@code published} in would make this read as a statement about what {@code 0} means. It means what an
	 * operator typed: a tier granting nothing is a legitimate row, and only selling one is refused (see
	 * {@link TierEdited.NothingToGrant}).
	 */
	public boolean grantsNothing() {
		return grantsNothing(this.relistQuotaPerPeriod);
	}

	/**
	 * The same question of a bare quota, for the readers holding one outside a {@link TierEdit} —
	 * {@code CatalogEntry}, which is the read side of the same row and cannot build an edit to ask.
	 *
	 * <p>{@code Integer.valueOf(0).equals(...)} rather than {@code quota == 0}, and that is the whole reason
	 * this is a method: unlimited is {@code null} (ADR-0029), so the unboxing comparison throws a
	 * {@link NullPointerException} on the most generous tier in the catalog — on a path whose job is to
	 * decide whether that tier may be sold.
	 */
	public static boolean grantsNothing(Integer relistQuotaPerPeriod) {
		return Integer.valueOf(0).equals(relistQuotaPerPeriod);
	}

}
