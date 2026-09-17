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
 * <p><strong>What the CRUD is and is not.</strong> It cannot set a price: the amount is Stripe's and
 * immutable. It does not write a {@code tier} row for a creation either — a plan is created in Stripe and
 * tagged with its code, and the sync drafts the row (ADR-0019), which is what T61's New plan button drives
 * rather than going round. What is editable is what this application actually owns — the quota, the name, the
 * flags, whether it is on sale, the order the catalog reads in, and which tier new accounts start on.
 *
 * <p><strong>Deleting was on that list and is not any more</strong> (T77,
 * {@link com.mprelist.catalog.TierEdits#delete}; ADR-0032). The sentence here said a tier is retired by
 * unpublishing it rather than by deleting a row its subscribers reference, and that was a foreign key
 * speaking rather than anything an operator would recognise. Every tier is now deletable including the
 * default and the last, which is also <strong>the first thing this module composes rather than forwards</strong>:
 * {@code CatalogAndSubscribers} is one transaction across {@code catalog}'s rows and {@code subscription}'s,
 * because a delete moves people and neither module may reach into the other to do it. It still owns no table
 * and decides nothing about what a tier grants.
 */
@ApplicationModule
package com.mprelist.admin;

import org.springframework.modulith.ApplicationModule;
