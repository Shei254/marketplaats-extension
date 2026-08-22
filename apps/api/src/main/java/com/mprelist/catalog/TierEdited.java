package com.mprelist.catalog;

/**
 * What came of an operator's edit (T53, #84).
 *
 * <p>Three answers and no exceptions, for {@code Checkout}'s reason one module over: the caller turns each
 * into a different status, and the difference matters to somebody looking at a form. One is the row as it now
 * stands, one is a code nothing is stored under, and one is a tier that cannot be sold because there is
 * nothing to charge for it.
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

}
