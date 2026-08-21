package com.mprelist.catalog;

/**
 * A Stripe Price that says which tier it is for, as this module needs it (#82, T51).
 *
 * <p>ADR-0019 makes {@code metadata.tier_code} the tag a Price is adopted by, rather than an id somebody
 * pastes into a form: {@code code} is already the stable handle everything in this catalog references, so
 * tagging the Price with it means the link between the two systems is never typed twice and so cannot drift.
 *
 * <p><strong>An untagged Price is not one of these.</strong> Stripe Prices get created for one-offs, coupons
 * and experiments, and a sync that adopted all of them would turn a billing experiment into a tier — so the
 * absence of a tag is decided before anything is constructed here, and this type cannot represent it.
 *
 * @param tierCode the {@code metadata.tier_code} the Price carries — the tier it fills in, or the code of the
 * draft it creates
 * @param stripePriceId Stripe's id for the Price, which is what a Checkout session (#29) is opened with
 * @param name what to call the tier, or {@code null} where the Price says nothing. Stripe's own nickname for
 * a Price is optional and usually unset, and a tier is better left with the name it has than renamed to
 * nothing — so this is a suggestion rather than a value, and {@link PriceAdoptions} says what happens to it
 */
public record TaggedPrice(String tierCode, String stripePriceId, String name) {

	public TaggedPrice {
		if (tierCode == null || tierCode.isBlank()) {
			throw new IllegalArgumentException("An untagged Price is not a plan and never reaches this type");
		}
		if (stripePriceId == null || stripePriceId.isBlank()) {
			throw new IllegalArgumentException("A Price with no id is nothing a Checkout session could name");
		}
		if (name != null && name.isBlank()) {
			// Blank and absent are the same thing said twice, and only one of them can be handled once.
			name = null;
		}
	}

}
