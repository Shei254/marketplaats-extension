/**
 * Tier to Entitlement resolution, from our own table — quota per period, max Marktplaats accounts, feature
 * flags. Its public API is {@link com.mprelist.catalog.TierId}, {@link com.mprelist.catalog.TierCatalog} and
 * {@link com.mprelist.catalog.Entitlement} (ADR-0012), which is now all of it.
 *
 * <p><strong>No Stripe dependency belongs here</strong> (ADR-0014): Stripe is authoritative for money,
 * this module is authoritative for what a tier grants.
 *
 * <p>Two questions, both on {@link com.mprelist.catalog.TierCatalog}: which tier a new account starts on
 * ({@code defaultTier()}, #20), and what a tier grants whoever is on it ({@code entitlementOf(TierId)}, #21 —
 * the thing #22's gate reads before it reserves a unit). Neither is about a user: which tier somebody is
 * subscribed to is {@code subscription}'s to answer, and the gate is what puts the two together.
 *
 * <p>Since #82 there is also one <em>write</em>, on a port of its own:
 * {@link com.mprelist.catalog.PriceAdoptions} takes the {@link com.mprelist.catalog.TaggedPrice} the
 * {@code billing} module reads out of a Stripe event and fills in — or drafts — the tier it names (ADR-0019).
 * Still no Stripe dependency here: what crosses the boundary is three strings, and a Price is known to this
 * module only as the id ADR-0014 made the link between what a plan costs and what it grants.
 */
@ApplicationModule
package com.mprelist.catalog;

import org.springframework.modulith.ApplicationModule;
