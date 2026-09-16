package com.mprelist.catalog;

import java.util.List;
import java.util.Optional;

/**
 * What this module answers about the tiers, read from our own table and never from Stripe (ADR-0014).
 *
 * <p>An interface with its implementation in {@code internal} rather than a class here, because the query is
 * the adapter half of ADR-0012's ports and adapters: {@code subscription} should be able to ask which tier a
 * new account starts on without also being able to see that the answer comes from JDBC.
 *
 * <p>Every question here arrived with the ticket that had to ask it: which tier a new account starts on
 * (#20), what a tier grants whoever is on it (#21), what it is called (#26), what a buyer could choose (#80),
 * and which tier a Stripe Price is the price of (#30). They exist so that no other module reads the
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
	 * <p><strong>An {@link Optional} since T77, and it used to throw.</strong> The sentence here said that a
	 * catalog with no default is "a deployment that cannot provision anybody — a state to fail on, not one for
	 * each caller to branch on and get differently wrong", and that was true for as long as nothing could
	 * delete a tier. ADR-0032 makes every tier deletable including the last, so an empty catalog is now
	 * reachable on purpose: <strong>a state and not corruption</strong>. The partial unique index
	 * {@code tier_single_default} still makes the answer at most one row; nothing has ever made it at least
	 * one, and now nothing pretends to.
	 *
	 * <p>What the two callers do with an empty answer is the whole of what that costs, and neither of them
	 * branches wrongly for want of an exception: {@code ProvisionOnFirstLogin} writes a subscription naming no
	 * tier, and {@code SubscriptionRows.ended()} leaves a cancelled subscriber naming none. Both are then
	 * denied {@code NO_TIER} — a code that says what happened — rather than being refused by a {@code 500} on
	 * the way in.
	 *
	 * @return the default tier, or nothing where the catalog holds no tier carrying the flag — which is an
	 * emptied catalog, and a catalog whose default was the tier just deleted
	 */
	Optional<TierId> defaultTier();

	/**
	 * What a tier grants whoever is on it: the {@link Entitlement} #22 checks a relist against and #26 renders.
	 *
	 * <p>Throws for a tier that is not there, which {@link #defaultTier()} stopped doing in T77 and this did
	 * not — because the two absences are different. A missing default is a catalog an operator emptied; a
	 * {@link TierId} that resolves to nothing is an id this module never issued. Since ADR-0032 a tier
	 * <em>can</em> go out from under a subscriber, and what happens then is that their {@code tier_id} becomes
	 * null ({@code on delete set null}) and they are denied {@code NO_TIER} before anything reaches here —
	 * {@link com.mprelist.subscription.Subscription#tier()} is an {@link java.util.Optional}, so the compiler
	 * is what stops a deleted tier arriving as an id. The empty answer this would otherwise give is the one
	 * a gate whose job is to fail closed would most likely read as "no quota", and that denial is
	 * indistinguishable from an ordinary exhausted user — which is how a catalog fault comes to look like the
	 * product working.
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
	 * <p>Throws for a tier that is not there, for {@link #entitlementOf(TierId)}'s reason and one of its own:
	 * the caller of this holds a subscription that <em>names</em> a tier, and since T77 naming one is a thing
	 * a subscription may not do — so an id that arrives here and resolves to nothing is one this module never
	 * issued, rather than an empty answer to render as a blank plan.
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

	/**
	 * The tier a Stripe Price is the price of — the other direction of the link ADR-0014 makes between what a
	 * plan costs and what it grants, and what turns "Stripe says they are paying for {@code price_pro}" into a
	 * tier to put somebody on (T20, #30).
	 *
	 * <p><strong>Published or not.</strong> Unlike {@link #published()} this answers for any tier holding the
	 * Price, because a subscriber does not lose what they bought when an operator takes the plan off sale —
	 * withdrawing a tier stops new purchases, and the people already on it keep renewing until they cancel.
	 * Filtering here would drop exactly those renewals on the floor.
	 *
	 * <p>An {@link Optional} rather than the throw the three reads above use, and the difference is that this
	 * id comes from <em>Stripe</em> rather than from a row of ours. A Price that belongs to no tier is an
	 * ordinary thing for a Stripe account to hold — a one-off, a coupon, an experiment (ADR-0019) — so an
	 * empty answer here is something for the caller to act on rather than a broken invariant.
	 *
	 * @param stripePriceId the Price id as Stripe spells it
	 * @return the tier carrying that Price, or nothing where no tier does. Never more than one:
	 * {@code tier.stripe_price_id} is unique, which is what makes this lookup an answer rather than a choice
	 */
	Optional<TierId> tierSoldAs(String stripePriceId);

}
