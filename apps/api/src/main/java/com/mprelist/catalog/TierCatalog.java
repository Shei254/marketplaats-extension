package com.mprelist.catalog;

/**
 * What this module answers about the tiers, read from our own table and never from Stripe (ADR-0014).
 *
 * <p>An interface with its implementation in {@code internal} rather than a class here, because the query is
 * the adapter half of ADR-0012's ports and adapters: {@code subscription} should be able to ask which tier a
 * new account starts on without also being able to see that the answer comes from JDBC.
 *
 * <p>Two questions, and they are the two ADR-0012 puts on this interface: which tier a new account starts on
 * (#20), and what a tier grants whoever is on it (#21). Both exist so that no other module reads the
 * {@code tier} table, which is exactly the coupling the module layout exists to prevent.
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

}
