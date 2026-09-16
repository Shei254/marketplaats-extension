package com.mprelist.catalog;

import java.util.List;
import java.util.UUID;

/**
 * What a deleted tier still owes Stripe, and the draining of it (T77,
 * <a href="../../../../../../../docs/adr/0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md">ADR-0032</a>).
 *
 * <p><strong>A fourth port beside {@link TierCatalog}, {@link PriceAdoptions} and {@link TierEdits}</strong>,
 * for the reason those three are separate from each other: this one is written by a delete and read by a
 * scheduled job, and neither of them has any business reading a quota or setting one.
 *
 * <p><strong>Why the queue is this module's at all, when every row in it is a Stripe id.</strong> It is
 * keyed on a <em>tier code</em>, and the question it exists to answer on the hot path is the catalog's own:
 * {@link PriceAdoptions#adopt} refuses to draft a code that still has unfinished work here. Deleting the row
 * immediately reopens the resurrection window — the tier is gone while its Prices are still tagged, and a
 * {@code price.updated} arriving in between drafts it right back — so the refusal has to be one statement
 * away from the upsert rather than a question asked across a module boundary. That is the tombstone ADR-0032
 * scopes to the window instead of to for ever: <strong>a code frees the moment its last row is done</strong>.
 *
 * <p>The ids are opaque here. This module stores them and says which kind each is; {@code billing} is the one
 * module that has heard of Stripe (ADR-0014) and is what turns a row into a call.
 */
public interface TierTeardown {

	/**
	 * Capture the calls a tier's deletion leaves outstanding, in the transaction that deletes it.
	 *
	 * <p><strong>Captured and never re-derived, which is the whole reason this is called where it is.</strong>
	 * A moment later {@code tier_price} has cascaded away, the Product id was never stored, and the
	 * ex-subscribers' {@code tier_id} is null and indistinguishable from anyone orphaned by a different
	 * deletion. So the ids are copied in while they still exist, and nothing afterwards has to reconstruct
	 * what was on the tier.
	 *
	 * <p><strong>Idempotent per Stripe object.</strong> An id already outstanding for the same kind is left
	 * exactly as it is, attempts and all — which is what lets the drain offer the same {@code ARCHIVE_PRODUCT}
	 * once per Price of the tier and get one call out of it.
	 *
	 * @param tierCode the tier that was deleted, which is what {@link PriceAdoptions#adopt} reads back
	 * @param kind which call these are
	 * @param stripeIds the objects to make it about, in any order and possibly empty — a tier nobody had
	 * bought owes no cancellations, and a tier with no Price owes no archiving
	 */
	void enqueue(String tierCode, StripeCleanup kind, List<String> stripeIds);

	/**
	 * Whether anything is still outstanding for this tier code.
	 *
	 * <p><strong>Two callers ask it, and that is why it is here rather than private to the table.</strong>
	 * {@link PriceAdoptions#adopt} asks it of every {@code price.created} and {@code price.updated}, to refuse
	 * drafting a tier whose Prices are still tagged. And {@code POST /api/admin/plans} asks it before it
	 * touches Stripe at all: creating a plan under a code still being torn down would make a Product and
	 * tagged Prices that the adopt behind them then declines, leaving an operator with Stripe objects no
	 * cleanup row covers and this API with nothing it could honestly answer.
	 *
	 * <p>It is a statement about the <em>window</em> and not about the code: it stops being true the moment
	 * the last row for that code is done, which is what keeps this from being the permanent tombstone
	 * ADR-0032 rejected. An operator deleting a plan and recreating it under the same name is doing something
	 * ordinary, and the only thing standing between them and it is a drain that takes a minute.
	 */
	boolean isBeingTornDown(String tierCode);

	/**
	 * The calls still outstanding, oldest first, at most {@code limit} of them.
	 *
	 * <p>Oldest first so that a tier deleted an hour ago finishes before one deleted a moment ago starts, and
	 * capped so that one drain is one bounded run of Stripe calls rather than however many an afternoon's
	 * tidying produced. Nothing is locked: two instances draining at once make each call twice, and every
	 * call here is idempotent against Stripe by being a statement of the state wanted — archived, untagged,
	 * cancelled — rather than a change to it.
	 */
	List<OutstandingCleanup> outstanding(int limit);

	/**
	 * Stripe agreed, or has nothing left to agree to.
	 *
	 * <p>The second is not a special case worth a second method: a Price Stripe says does not exist is a Price
	 * that is not going to resurrect a tier, which is the whole of what archiving it was for.
	 */
	void done(UUID call);

	/**
	 * Stripe refused, or could not be asked. The attempt is counted and the sentence kept.
	 *
	 * <p>Kept rather than only logged, because the row is where an operator would look: a queue that is never
	 * empty says nothing, and a row that has been tried forty times carrying Stripe's own words about why is
	 * the whole of what makes this visible without a dashboard.
	 *
	 * @param why Stripe's own message, or ours where Stripe was not reachable at all
	 */
	void failed(UUID call, String why);

}
