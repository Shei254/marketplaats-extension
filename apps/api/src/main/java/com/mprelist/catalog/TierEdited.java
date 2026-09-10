package com.mprelist.catalog;

/**
 * What came of an operator's edit (T53, #84).
 *
 * <p>Four answers and no exceptions, for {@code Checkout}'s reason one module over: the caller turns each
 * into a status, and the difference matters to somebody looking at a form. One is the row as it now stands,
 * one is a code nothing is stored under, and two are tiers that cannot be sold — one because there is
 * nothing to charge for it, one because there is nothing to get for the money.
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

}
