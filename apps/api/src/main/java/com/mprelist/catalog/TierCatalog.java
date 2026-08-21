package com.mprelist.catalog;

import java.util.List;

/**
 * What this module answers about the tiers, read from our own table and never from Stripe (ADR-0014).
 *
 * <p>An interface with its implementation in {@code internal} rather than a class here, because the query is
 * the adapter half of ADR-0012's ports and adapters: {@code subscription} should be able to ask which tier a
 * new account starts on without also being able to see that the answer comes from JDBC.
 *
 * <p>Three questions, and each arrived with the ticket that had to ask it: which tier a new account starts on
 * (#20), what a tier grants whoever is on it (#21), and what it is called (#26). All three exist so that no
 * other module reads the {@code tier} table, which is exactly the coupling the module layout exists to
 * prevent.
 *
 * <p><strong>Neither question is about a user.</strong> Which tier somebody is subscribed to is
 * {@code subscription}'s to answer — it holds the mirror of Stripe's view — and #22's gate is what puts the
 * two together: it reads the subscriber's tier from there and brings it here to find out what it grants.
 */
public interface TierCatalog {

	/**
	 * The tier every new account is provisioned onto: the one row carrying {@code is_default}, which
	 * {@code V2__seed_tier_catalog.sql} makes Free and an operator may move to another tier at any time.
	 *
	 * <p>Throws rather than returning an empty {@link java.util.Optional}, and that is the point of it.
	 * ADR-0014 makes "every user always has a Subscription" an invariant, so a catalog with no default is a
	 * deployment that cannot provision anybody — a state to fail on, not one for each caller to branch on and
	 * get differently wrong. The partial unique index {@code tier_single_default} is what makes the answer at
	 * most one row; this is what makes it at least one.
	 *
	 * @throws IllegalStateException if no tier carries the flag
	 */
	TierId defaultTier();

	/**
	 * What a tier grants whoever is on it: the {@link Entitlement} #22 checks a relist against and #26 renders.
	 *
	 * <p>Throws for a tier that is not there, for the same reason {@link #defaultTier()} does. A subscription
	 * holds its tier behind a foreign key with no delete rule, so a row cannot go out from under a subscriber
	 * — an id that resolves to nothing came from somewhere this module never wrote it, and the empty
	 * {@link java.util.Optional} that reported it would most likely be read as "no quota" by a gate whose job
	 * is to fail closed. That denial is indistinguishable from an ordinary exhausted user, which is how a
	 * catalog fault would come to look like the product working.
	 *
	 * @param tier the tier to resolve, as named by a subscription or by {@link #defaultTier()}
	 * @throws IllegalStateException if no tier carries that id
	 */
	Entitlement entitlementOf(TierId tier);

	/**
	 * What a tier is called — the pair {@link TierName} carries, for the caller that has somebody to show it
	 * to. #26's {@code /api/me} renders the caller's own plan, which is the arrival ADR-0012 and
	 * {@link Entitlement} both said this question was waiting for; #43's plans page is the second.
	 *
	 * <p>A second read rather than a widened {@link #entitlementOf(TierId)}, because the gate calls that one
	 * on the authorize path and has no use for display text: an entitlement that also carried a label would
	 * make every relist fetch two columns nothing checks. This is the display path and is not the hot one.
	 *
	 * <p>Throws for a tier that is not there, for {@link #defaultTier()}'s reason and one of its own: the
	 * caller of this holds a subscription that names the tier, so an id resolving to nothing is a foreign key
	 * that cannot happen rather than an empty answer to render as a blank plan.
	 *
	 * @param tier the tier to name, as a subscription names it
	 * @throws IllegalStateException if no tier carries that id
	 */
	TierName nameOf(TierId tier);

	/**
	 * Everything a buyer could choose: the tiers that are {@code published} <em>and</em> carry a
	 * {@code stripe_price_id} (T49, #80).
	 *
	 * <p>Both halves are true of every row this returns, and {@code published} is the only one it has to
	 * check: {@code V5__tier_publication.sql} makes a published tier with no price unwriteable, so the flag
	 * already implies the id. What each half excludes is different, though — the flag keeps out the drafts
	 * ADR-0019's webhook creates at quota 0 for a Price nobody has decided about yet, and the price keeps out
	 * the free tier, an ordinary row that happens to have nothing to charge against. A catalog where either
	 * slipped through would put a card on the plan screen whose button opens a Checkout for nothing.
	 *
	 * <p>A list rather than a stream or a page: the catalog is a handful of rows an operator maintains by
	 * hand, and the caller renders all of them.
	 *
	 * @return the sellable tiers, empty if nothing is on sale — which is a real state and not a fault, since
	 * a stack whose Stripe Prices have not been created yet ({@code T22}, #28) has published nothing
	 */
	List<SellablePlan> published();

}
