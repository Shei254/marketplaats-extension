/**
 * Tier to Entitlement resolution, from our own table — quota per period, max Marktplaats accounts, feature
 * flags. Its planned public API is {@code TierId} and {@code Entitlement} (ADR-0012).
 *
 * <p><strong>No Stripe dependency belongs here</strong> (ADR-0014): Stripe is authoritative for money,
 * this module is authoritative for what a tier grants. Empty until #21 (T12).
 */
@ApplicationModule
package com.mprelist.catalog;

import org.springframework.modulith.ApplicationModule;
