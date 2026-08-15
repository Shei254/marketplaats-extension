/**
 * Tier to Entitlement resolution, from our own table — quota per period, max Marktplaats accounts, feature
 * flags. Its planned public API is {@code TierId} and {@code Entitlement} (ADR-0012).
 *
 * <p><strong>No Stripe dependency belongs here</strong> (ADR-0014): Stripe is authoritative for money,
 * this module is authoritative for what a tier grants.
 *
 * <p>{@link com.mprelist.catalog.TierId} and the one question #20 had to ask —
 * {@link com.mprelist.catalog.TierCatalog#defaultTier()}, which tier a new account starts on — are here.
 * {@code Entitlement}, what a tier grants and the thing #22's gate reads, is #21 (T12).
 */
@ApplicationModule
package com.mprelist.catalog;

import org.springframework.modulith.ApplicationModule;
