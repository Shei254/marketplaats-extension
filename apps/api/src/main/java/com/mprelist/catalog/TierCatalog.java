package com.mprelist.catalog;

/**
 * What this module answers about the tiers, read from our own table and never from Stripe (ADR-0014).
 *
 * <p>An interface with its implementation in {@code internal} rather than a class here, because the query is
 * the adapter half of ADR-0012's ports and adapters: {@code subscription} should be able to ask which tier a
 * new account starts on without also being able to see that the answer comes from JDBC.
 *
 * <p>One method today. {@code Entitlement} — what a tier <em>grants</em>, which is the rest of ADR-0012's
 * public API for this module — is #21's, and is the thing #22's gate reads. This is the part #20 needed
 * first: provisioning has to name a tier, and reading the {@code tier} table from another module would be
 * exactly the coupling the module layout exists to prevent.
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

}
