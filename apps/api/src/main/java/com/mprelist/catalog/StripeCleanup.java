package com.mprelist.catalog;

/**
 * One kind of Stripe call a deleted tier leaves behind (T77,
 * <a href="../../../../../../../docs/adr/0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md">ADR-0032</a>).
 *
 * <p><strong>Three kinds because there are three Stripe objects</strong>, and the order they are named in is
 * the order they matter in. Cancelling is what stops real money moving — archiving a Price stops <em>new</em>
 * purchases and existing subscriptions go on renewing against it, so a delete that only tidied the catalog
 * would leave customers paying monthly for a tier that no longer exists. Archiving a Price is what "delete"
 * means in Stripe, where {@code PriceService} has no {@code delete} at all. Archiving the Product is
 * tidiness, and the one call whose id is not known when a tier is deleted.
 *
 * <p><strong>An enum here, and the calls themselves in {@code billing}.</strong> This module holds the queue
 * because the thing it is keyed on is a tier code and because {@code PriceAdoptions.adopt} has to read it —
 * a code with unfinished work is a code the sync refuses to draft, which is the tombstone ADR-0032 scopes to
 * the window rather than to for ever. What each of these <em>is</em> in Stripe's vocabulary is
 * {@code billing}'s, which is the module that has heard of Stripe (ADR-0014).
 */
public enum StripeCleanup {

	/**
	 * A live Stripe subscription on the deleted tier, to be cancelled ({@code sub_…}).
	 *
	 * <p>Each cancellation comes back as a {@code customer.subscription.deleted} webhook, which runs
	 * {@code MirrorSubscriptions.ended()} and therefore ADR-0018's fallback — so the subscriber's own side of
	 * this is the path that already ships, arriving by the route it always arrives by.
	 *
	 * <p><strong>No refund rides with it.</strong> Money is decided in Stripe (ADR-0014), where an operator
	 * can issue one per customer; an API that refunded on a catalog edit would be making a money decision
	 * nobody asked it for.
	 */
	CANCEL_SUBSCRIPTION,

	/**
	 * A Stripe Price the tier was sold at: {@code active = false} <em>and</em> {@code metadata[tier_code]}
	 * cleared, which ride in one {@code price.update} ({@code price_…}).
	 *
	 * <p><strong>The untagging is the half that is not optional.</strong> Archiving alone fires a
	 * {@code price.updated} still carrying the code, and {@code adopt} would draft the tier straight back at
	 * quota 0, filed last, as a {@code LOG.warn} nobody is reading. Cleared, the tag reads as absent —
	 * {@code StripeEvent.text()} answers null for a blank — so the event the clearing itself fires is a no-op
	 * by construction.
	 */
	ARCHIVE_PRICE,

	/**
	 * The Stripe Product those Prices belonged to ({@code prod_…}).
	 *
	 * <p><strong>The one kind that is not enqueued by the delete</strong>, because the Product id has never
	 * been stored: {@code tier_price} holds Price ids and nothing else, so learning it costs a
	 * {@code retrieve} per Price — which the drain does as it archives one, and enqueues this from what came
	 * back. Two of a tier's Prices share one Product and offer it twice, which
	 * {@code stripe_cleanup_one_outstanding_call_per_object} makes a no-op rather than a duplicate call.
	 *
	 * <p><strong>Archived and not deleted</strong>, because Stripe permits {@code ProductService.delete} only
	 * for a Product with no Prices attached — and since the Prices cannot be deleted, a Product that ever had
	 * one can only ever be archived. {@code CreateStripePlans} says of an orphaned Product that it is
	 * "harmless, invisible to this application — nothing reads Products", which stays true of a half-failed
	 * <em>create</em> and is not true of a dashboard accumulating one per deleted plan.
	 */
	ARCHIVE_PRODUCT

}
