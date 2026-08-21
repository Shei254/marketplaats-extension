/**
 * What Stripe tells us, and what we do about it — the receiving end of ADR-0019 and ADR-0006.
 *
 * <p>Its public API is a route and nothing else: {@code POST /api/stripe/webhook}, which nobody in this
 * application calls and no other module asks anything of. Like {@code display} it is a leaf, but the other
 * way round — that one composes four modules' answers for a caller, this one turns somebody else's event into
 * one module's write.
 *
 * <p><strong>The route is authenticated by a signature rather than by a token</strong>, which makes it the
 * first thing here that is not closed behind Keycloak. Stripe holds no account in our realm and could not
 * present a bearer token; what it does present is an HMAC of the exact bytes it sent, keyed by a secret only
 * the two ends hold. Which is why the chain in {@code identity} opens this one path by name — see
 * {@link com.mprelist.identity.RoutesNeedingARole}, whose own documentation says that opening a route is a
 * decision that belongs in the chain where a reviewer will see it, rather than one contributed from here.
 *
 * <p><strong>Stripe stays out of every other module.</strong> {@code catalog} is handed a
 * {@link com.mprelist.catalog.TaggedPrice} — three strings — and never a Stripe type, which is what keeps
 * ADR-0014's "no Stripe dependency in the catalog" true now that a Stripe event is what fills it in.
 *
 * <p>#82 (T51) ships the Price half: {@code price.created} and {@code price.updated} adopt a Price into the
 * tier it names. The subscription half is #30 (T20), and it is the one that needs a log of event ids —
 * mirroring a status is order-dependent and repeat-sensitive in a way an upsert on a tier code is not.
 */
@ApplicationModule
package com.mprelist.billing;

import org.springframework.modulith.ApplicationModule;
