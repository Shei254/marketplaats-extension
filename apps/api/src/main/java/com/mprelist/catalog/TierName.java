package com.mprelist.catalog;

/**
 * What a tier is called, in the two spellings a client needs at once: the handle it may branch on, and the
 * text it puts on the screen.
 *
 * <p><strong>Not an {@link Entitlement}, and that is the point of a second type.</strong> An entitlement is
 * what being on a tier lets its holder <em>do</em>; this is what the tier is <em>called</em>, which is
 * nothing anybody is entitled to and nothing the gate reads. #26's {@code /api/me} is the first caller with
 * somebody to show it to, which is when ADR-0012 said this question would arrive.
 *
 * <p><strong>Both halves, because a client that got one would build the other badly.</strong> Given only
 * {@code name}, a popup deciding "is this the free plan" would branch on display text an operator may
 * rewrite at any time (ADR-0014) — and the day somebody edits "Free" to "Gratis" the branch stops matching
 * with nothing to say so. Given only {@code code}, the same popup renders {@code power} to a human, or keeps
 * a second catalog of labels beside ours that a rename never reaches. So the wire carries the pair, and
 * which is which is stated here rather than guessed at each reader.
 *
 * @param code the stable handle: {@code tier.code}, what {@code V2__seed_tier_catalog.sql} upserts on and the
 * one thing about a tier an admin edit does not move
 * @param name display text, {@code tier.name}, an operator's to rewrite. Rendered, never compared — a blank
 * one is not refused here, because a tier somebody typed an empty label for should show an empty label rather
 * than take {@code /api/me} down for its subscribers, which is what an exception on this path would do
 */
public record TierName(String code, String name) {

	/**
	 * Both columns are {@code not null} in {@code V1__baseline_schema.sql}, restated where a name is built
	 * for {@link Entitlement}'s reason: a test standing one up without a catalog behind it should not be able
	 * to make a tier the table would have refused.
	 */
	public TierName {
		if (code == null) {
			throw new IllegalArgumentException("A tier is named by its code, which is not null and is what the "
					+ "seed upserts on");
		}
		if (name == null) {
			throw new IllegalArgumentException("A tier carries display text even when nobody has edited it; "
					+ "tier.name is not null");
		}
	}

}
