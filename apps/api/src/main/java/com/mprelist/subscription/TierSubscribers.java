package com.mprelist.subscription;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.mprelist.catalog.TierId;

/**
 * What a change to the catalog does to the people on it (T77,
 * <a href="../../../../../../../docs/adr/0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md">ADR-0032</a>).
 *
 * <p><strong>A third port beside {@link Subscriptions} and {@link SubscriptionMirror}</strong>, for the
 * reason those two are apart from each other: one is read by the gate on every relist and one is written to
 * by a webhook, and this is written to by an operator deleting a plan. A reader that could also move every
 * subscriber off a tier is a reader that eventually does.
 *
 * <p><strong>Nothing here is about one user, and that is what makes it safe to be a port at all.</strong>
 * Every method takes a tier and acts on whoever is on it, so there is no parameter anybody could put one
 * person's id into. The two writes are the two moments ADR-0032 creates — a tier being deleted, and a default
 * flag arriving somewhere — and both are composed with {@code catalog}'s own half in a single transaction by
 * {@code admin}, which is the module allowed to know about more than one of these.
 */
public interface TierSubscribers {

	/**
	 * How many accounts are on each tier, and how many of those Stripe is currently billing.
	 *
	 * <p><strong>For the confirmation, which is the whole reason it exists</strong>: a delete has to be able
	 * to say how many subscribers move and how many live subscriptions will be cancelled, before it is
	 * pressed. {@code /admin} then requires the tier's name to be typed only when the second number is above
	 * zero — friction tracking consequence, so undoing a plan created a minute ago stays one click.
	 *
	 * <p>The whole catalog in one statement rather than a count per tier: the admin table renders every row
	 * and asking per row would be N round trips for a screen that is one.
	 *
	 * <p>Keyed by {@link TierId} rather than by code, which is why {@code CatalogEntry} carries its row's id.
	 * A code is the catalog's handle and this module has never read the {@code tier} table — keying on one
	 * would mean a join across a boundary that exists so there is no join.
	 *
	 * @return a count per tier that has anybody on it. <strong>A tier nobody is on is absent</strong> rather
	 * than present as a zero: this is a count of subscription rows, and a tier with none has none
	 */
	Map<TierId, SubscriberCount> countsByTier();

	/**
	 * Move everybody off a tier, and say which Stripe subscriptions were live on it.
	 *
	 * <p><strong>One call rather than a read and then a write</strong>, and the ordering is the point: the
	 * ids have to be read before the rows are moved, because afterwards nothing distinguishes the people who
	 * were on that tier from anybody else. A caller that had to remember to ask first would be a caller that
	 * can forget to — which is {@code Subscriptions.currentFor}'s argument about rolling a closed window,
	 * applied to a write.
	 *
	 * <p><strong>The returned ids are the only Stripe identifiers this module hands out beside
	 * {@link Subscriptions#stripeCustomerFor}</strong>, and they leave for the same kind of reason: they are
	 * not a field on {@link Subscription} that a gate could come to branch on, they are the answer to one
	 * question asked once, by the one caller that has to make those calls. What is done with them is
	 * {@code billing}'s — this module has never heard of Stripe beyond the shape of an id.
	 *
	 * <p><strong>Moving is deliberate rather than left to the foreign key.</strong> {@code V11} makes
	 * {@code tier_id} {@code on delete set null}, so deleting the row would orphan everybody by itself; that
	 * rule is the backstop for the two cases where there is nowhere to move them to, and this is what makes
	 * the ordinary case land them on the default tier instead.
	 *
	 * @param tier the tier being emptied
	 * @param onto where its subscribers should land — the Default tier, or empty where the tier being deleted
	 * <em>is</em> the default, or is the last one there is. Empty leaves them naming no tier, which is a
	 * state and not corruption: they are denied {@code NO_TIER} until a default exists again
	 * @return the {@code sub_…} of every subscription Stripe is still billing on that tier, which is the list
	 * of cancellations the tear-down owes. Empty for a tier nobody ever bought, which is every free tier and
	 * every draft
	 */
	List<String> moveEveryoneOn(TierId tier, Optional<TierId> onto);

	/**
	 * Point every subscription that names no tier at the one that now carries the default flag.
	 *
	 * <p><strong>Precise rather than merely convenient.</strong> A subscription is tier-less <em>only</em>
	 * because no default existed when their tier was deleted, and the route that moves the flag is the sole
	 * writer of it — so this is the one moment that stops being true, and healing here fixes everybody at
	 * once, including the users who never sign in again.
	 *
	 * <p>Healing lazily in {@link Subscriptions#currentFor} was the alternative and is rejected in ADR-0032:
	 * it already locks the row and already rolls a closed window forward, so it would have been cheap — and
	 * it heals one user at a time, only when they show up, which leaves a catalog that looks repaired and a
	 * population that is not.
	 *
	 * @param tier the tier the orphans should land on, which is the new default
	 * @return how many rows were adopted — zero on every ordinary call, since a catalog that never lost its
	 * default has no orphans
	 */
	int adoptOrphansOnto(TierId tier);

}
