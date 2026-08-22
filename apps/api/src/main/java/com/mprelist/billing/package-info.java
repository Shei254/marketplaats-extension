/**
 * What Stripe tells us, and what we do about it — the receiving end of ADR-0019 and ADR-0006.
 *
 * <p><strong>Everything here is a route, and no other module asks this one anything</strong> — apart from
 * {@code display}, which reads a Price amount off {@link com.mprelist.billing.StripePrices} to draw a plan
 * card. Three of the routes are called by the popup ({@code GET /api/plans}'s half of the answer,
 * {@code POST /api/checkout} and {@code POST /api/portal}) and one is called by Stripe
 * ({@code POST /api/stripe/webhook}), which nobody in this application calls at all.
 *
 * <p><strong>The webhook is authenticated by a signature rather than by a token</strong>, which makes it the
 * one route here that is not closed behind Keycloak. Stripe holds no account in our realm and could not
 * present a bearer token; what it does present is an HMAC of the exact bytes it sent, keyed by a secret only
 * the two ends hold. Which is why the chain in {@code identity} opens this one path by name — see
 * {@link com.mprelist.identity.RoutesNeedingARole}, whose own documentation says that opening a route is a
 * decision that belongs in the chain where a reviewer will see it, rather than one contributed from here.
 *
 * <p><strong>Stripe stays out of every other module.</strong> {@code catalog} is handed a
 * {@link com.mprelist.catalog.TaggedPrice} — three strings — and never a Stripe type, and
 * {@code subscription} is handed our own normalized status, a window and two ids. That is what keeps
 * ADR-0014's "no Stripe dependency in the catalog" true now that a Stripe event is what fills it in, and what
 * makes this the one module a change of payment provider would touch (ADR-0012).
 *
 * <p>Two halves arrive on that one route. #82 (T51) is the Price half: {@code price.created} and
 * {@code price.updated} adopt a Price into the tier it names. #30 (T20) is the subscription half, and it is
 * what turns a payment into an entitlement — {@code customer.subscription.created}, {@code .updated} and
 * {@code .deleted} become the plan somebody is on. That half is order-dependent and repeat-sensitive in a way
 * an upsert on a tier code is not, which is handled where the row is written: a subscription remembers how
 * far through Stripe's telling it is, and an event older than that is not applied.
 *
 * <p>What is <em>not</em> here is a Stripe call on any hot path. This module asks Stripe for a Price amount
 * when the plan cards are drawn, opens a Checkout session when somebody buys and a Customer Portal session
 * when somebody manages what they bought (T21, #31); the gate reads our own mirror and never Stripe
 * (ADR-0006, ADR-0007).
 */
@ApplicationModule
package com.mprelist.billing;

import org.springframework.modulith.ApplicationModule;
