package com.mprelist.catalog;

/**
 * What came of an operator's edit (T53, #84).
 *
 * <p>Six answers and no exceptions, for {@code Checkout}'s reason one module over: the caller turns each
 * into a status, and the difference matters to somebody looking at a form. One is the row as it now stands,
 * one is a code nothing is stored under, two are tiers that cannot be sold — one because there is nothing to
 * charge for it, one because there is nothing to get for the money — and two are codes the catalog cannot
 * file this tier under (T76, ADR-0031).
 *
 * <p><strong>The last four are one sentence to the route and four to the reader here.</strong>
 * {@code AdministerTiers} answers {@code 409} to all of them with an empty body — "the catalog cannot hold
 * this tier as described" — because they are one recovery to the only caller, which is to look at the
 * catalog it is holding. They stay four types because the screen's own checks are written against four
 * different facts, and a single {@code Refused} would make this module the one place that had forgotten
 * which.
 */
public sealed interface TierEdited {

	/** Applied. The entry is the row as it now stands, read back rather than assembled from the request. */
	record Applied(CatalogEntry tier) implements TierEdited {
	}

	/**
	 * No tier carries that code. An ordinary answer rather than a fault: the codes an operator types come from
	 * a list they are holding, and a list can be out of date — a tier is never deleted here, but a stale client
	 * can still name one from a catalog that was seeded differently.
	 */
	record NoSuchTier() implements TierEdited {
	}

	/**
	 * The edit would publish a tier with no Stripe Price, which {@code V5__tier_publication.sql} refuses.
	 *
	 * <p>Answered rather than thrown, because it is the one mistake this form invites: a draft the sync created
	 * has a Price and is unpublished, while a tier somebody added by hand has neither, and both look ready to
	 * publish in a list. The way out is Stripe's — create a Price tagged with the code (ADR-0019) — and the
	 * message on the screen has to say so, which it cannot do if this arrives as a constraint violation.
	 */
	record NothingToChargeAgainst() implements TierEdited {
	}

	/**
	 * The edit would publish a tier granting no reposts, which {@code V9__unlimited_reposts.sql} refuses
	 * (ADR-0029).
	 *
	 * <p><strong>A rule about publishing, and not about what {@code 0} means.</strong> Zero keeps the meaning
	 * it reads as — a draft is adopted at it, and "there is no free tier" is said with it (ADR-0019) — and
	 * what is refused is putting such a tier on sale. Unlimited, spelled {@code null}, is not this: it grants
	 * everything rather than nothing.
	 *
	 * <p>Answered rather than thrown for {@link NothingToChargeAgainst}'s reason, and it closes the same gap
	 * from the other side: the {@code > 0} guard existed only on the webhook's auto-publish path, so an
	 * operator could hand-publish a zero-grant tier and a buyer could pay for it. The form warns and sends
	 * {@code published: false} itself, so this is the backstop for a stale tab, a script or a hand-run
	 * {@code curl} — which should be told they are wrong rather than quietly corrected.
	 */
	record NothingToGrant() implements TierEdited {
	}

	/**
	 * The edit would move the code of a tier that has a Stripe Price (T76, ADR-0031).
	 *
	 * <p><strong>Frozen by Stripe rather than by us.</strong> A Price carries the code in
	 * {@code metadata.tier_code} and that copy is how {@code PriceAdoptions} finds the tier again. Renaming
	 * underneath it would leave the tier holding Prices that name something else, and the next
	 * {@code price.updated} would adopt the old code as a <em>new draft tier</em> — one tier split in two by
	 * a rename, with subscribers on the half nobody is looking at.
	 *
	 * <p>Retagging every Price in the same operation was weighed and rejected in the ADR: a local commit plus
	 * N Stripe calls half-fails into exactly the split it is trying to prevent, and the sync cannot read a
	 * catalog in that state.
	 *
	 * <p>So the code moves exactly where nothing has a copy of it — a tier with no {@code tier_price} row,
	 * which in practice is the free tier and nothing else. Answered rather than thrown for
	 * {@link NothingToChargeAgainst}'s reason: the form knows which rows these are and shows the code as
	 * fixed text on the rest, so what reaches this is a stale tab, a script or a hand-run {@code curl}.
	 */
	record CodeFrozenByAPrice() implements TierEdited {
	}

	/**
	 * The edit would file this tier under a code another tier already holds (T76, ADR-0031).
	 *
	 * <p>{@code tier.code} is unique, so the alternative to answering this is a
	 * {@code DataIntegrityViolationException} under the route — a {@code 500} where what is wanted is an
	 * operator being told that the name they typed derives to a code the catalog is already using. Renaming
	 * the free tier to "Pro" derives {@code pro}, which is the whole of how this is reached: nobody types a
	 * code, so nobody collides on purpose.
	 *
	 * <p>Auto-suffixing to {@code pro-2} was rejected in the ADR as the "quietly corrected" ADR-0029 names as
	 * the thing not to do. The form refuses it before the submit; this is the backstop.
	 */
	record CodeTakenByAnotherTier() implements TierEdited {
	}

	/**
	 * A second tier with no Stripe Price, refused (T79).
	 *
	 * <p><strong>This is the one invariant in this file that used to need no enforcing.</strong>
	 * <a href="../../../../../../../../docs/adr/0031-the-free-tier-is-the-one-without-a-price.md">ADR-0031</a>
	 * defines the free tier as the tier with no {@code tier_price} row and rested "at most one" on the fact
	 * that every creation path went through Stripe: a priceless tier was <em>unsayable</em> rather than
	 * forbidden, which this codebase prefers and says so one class over.
	 *
	 * <p>T77 made every tier deletable, including the seeded free one — and then the only way to make another
	 * was a hand-written migration, because {@code adopt} is driven by a Price and {@code POST /api/admin/plans}
	 * demanded one. So the catalog could lose its free tier permanently, which also takes ADR-0018's fallback
	 * with it: every lapsed subscription lands on the default tier, and every tier an operator could still
	 * create was one somebody has to pay for.
	 *
	 * <p>Creating one without a Price is now sayable, so "at most one" becomes a rule this answers rather than
	 * a shape nobody could express. The cost is stated in the ADR the ticket amends and not hidden here.
	 */
	record FreeTierAlreadyExists() implements TierEdited {
	}

}
