/**
 * Operator-facing endpoints, guarded by the {@code ADMIN} realm role — the tier catalog an operator maintains,
 * and the Stripe Prices this application has never heard of.
 *
 * <p>#27 (T18) shipped the guard and no endpoint: {@code /api/admin/**} needs the role, said once as a
 * {@link com.mprelist.identity.RoutesNeedingARole} the filter chain applies, so that the routes T53 (#84)
 * added are closed by being here rather than by each of them remembering to ask. That is still the whole of
 * the security in this module: no handler below asks who is calling.
 *
 * <p><strong>It composes and owns nothing</strong>, which makes it {@code display}'s counterpart for the other
 * audience. The tier rows are {@code catalog}'s, reached through {@link com.mprelist.catalog.TierEdits} — a
 * third port beside the one the gate reads and the one the webhook writes, so that being able to set a quota
 * is a capability only this module has. The Prices are {@code billing}'s, reached through
 * {@link com.mprelist.billing.UnadoptedPrices}, which hands over our own records rather than Stripe types —
 * so ADR-0014's "Stripe stays in one module" holds here as it does everywhere else.
 *
 * <p><strong>What the CRUD deliberately is not.</strong> It cannot create a tier, delete one, or set a price:
 * a plan is created in Stripe and tagged with its code, the sync drafts the row (ADR-0019), the amount is
 * immutable, and a tier is retired by unpublishing it rather than by deleting a row its subscribers reference.
 * What is editable is what this application actually owns — the quota, the name, the flags, whether it is on
 * sale, and which tier new accounts start on.
 */
@ApplicationModule
package com.mprelist.admin;

import org.springframework.modulith.ApplicationModule;
