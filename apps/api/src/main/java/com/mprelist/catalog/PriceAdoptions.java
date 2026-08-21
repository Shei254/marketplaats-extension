package com.mprelist.catalog;

/**
 * How a Stripe Price becomes a tier in this catalog (#82, T51).
 *
 * <p>A second port beside {@link TierCatalog} rather than three more methods on it, because that one is what
 * the gate and the display read on every call and this is written to exactly once, by a webhook. Keeping them
 * apart is what stops a reader from acquiring a write it did not need — and what lets this one be
 * {@code @Transactional} without wrapping the hot path in a transaction it has no use for.
 *
 * <p><strong>Still no Stripe dependency in this module</strong> (ADR-0014): what arrives here is a
 * {@link TaggedPrice}, three strings the {@code billing} module read out of an event it verified. This module
 * owns the {@code tier} table and knows a Price only as the id ADR-0014 already made the link between the two
 * systems.
 */
public interface PriceAdoptions {

	/**
	 * Upserts on {@link TaggedPrice#tierCode()}, and the three rules ADR-0019 states are all here:
	 *
	 * <ul>
	 * <li><strong>A quota is never written.</strong> Not raised, not lowered, not defaulted over. A Price
	 * tagged with a code the catalog already knows fills in its {@code stripe_price_id} and nothing else that
	 * an operator decided.
	 * <li><strong>An unknown code drafts a tier</strong> at quota 0 and {@code published = false}, so a Price
	 * created before anybody said what it grants sells nothing rather than selling everything.
	 * <li><strong>Adoption publishes a tier that grants something</strong>, once — the first Price to land on
	 * a tier with a quota makes it buyable, which is what fills in the seeded {@code pro} and {@code power}.
	 * A later Price for the same tier repoints it and leaves {@code published} alone, so an operator who
	 * unpublished a tier does not find it back on sale because Stripe sent an update.
	 * </ul>
	 *
	 * <p>Idempotent, which is what a webhook needs of it: Stripe delivers at least once, and the same Price
	 * arriving twice makes the same row twice. Nothing here keeps a log of event ids for that reason — the
	 * events whose repetition or order <em>does</em> change an answer are the subscription ones (#30, T20),
	 * and the log belongs with them.
	 *
	 * @param price the Price and the tier it names
	 * @return which of the three happened, for the caller that has an operator to tell
	 */
	Adoption adopt(TaggedPrice price);

}
