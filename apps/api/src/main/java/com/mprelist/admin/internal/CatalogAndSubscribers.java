package com.mprelist.admin.internal;

import java.util.List;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.mprelist.catalog.CatalogEntry;
import com.mprelist.catalog.StripeCleanup;
import com.mprelist.catalog.TierCatalog;
import com.mprelist.catalog.TierEdits;
import com.mprelist.catalog.TierId;
import com.mprelist.catalog.TierPrice;
import com.mprelist.catalog.TierTeardown;
import com.mprelist.subscription.TierSubscribers;

/**
 * The two catalog writes that are also writes to somebody's subscription (T77,
 * <a href="../../../../../../../../docs/adr/0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md">ADR-0032</a>):
 * deleting a tier, and moving the default flag onto one.
 *
 * <p><strong>Here because {@code admin} is the module allowed to compose.</strong> A delete is one act and
 * three modules' business — the {@code tier} row and the queue its tear-down leaves are {@code catalog}'s,
 * the people on it are {@code subscription}'s, and the Stripe calls are {@code billing}'s — and none of the
 * three may reach into another to do it. {@code catalog} calling {@code subscription} would invert the
 * dependency the boundary check already enforces in the other direction, which is the failure ADR-0012's
 * layout exists to prevent. So the orchestration is here, where composing is the module's whole job, and each
 * module keeps writing only its own table.
 *
 * <p><strong>{@code @Transactional} is the point of the class, not a decoration on it.</strong> Both methods
 * are several statements across two modules' tables that have to commit together or not at all. The
 * alternative — a controller calling three services in sequence, each with a transaction of its own — leaves
 * a catalog with the tier deleted and everybody still pointed at it, or the flag moved and the orphans not
 * adopted, and neither state has anything to notice it.
 */
@Service
class CatalogAndSubscribers {

	CatalogAndSubscribers(TierCatalog tiers, TierEdits catalog, TierTeardown teardown,
			TierSubscribers subscribers) {
		this.tiers = tiers;
		this.catalog = catalog;
		this.teardown = teardown;
		this.subscribers = subscribers;
	}

	/**
	 * Delete a tier and everything that follows from it, in one transaction.
	 *
	 * <p><strong>The order is the whole design and is read top to bottom.</strong>
	 *
	 * <ol>
	 * <li><strong>Find the row</strong>, because everything after this needs it: its id to move people off,
	 * its Prices to capture the Stripe work. A code nothing is stored under stops here and is the route's one
	 * refusal.
	 * <li><strong>Move everybody to the default</strong> — or to no tier, where the tier being deleted
	 * <em>is</em> the default, or is the last one there is. The same call hands back the Stripe subscriptions
	 * that were live on it, because afterwards nothing distinguishes those people from anybody else.
	 * <li><strong>Capture the Stripe work</strong> from ids that are about to stop existing: {@code tier_price}
	 * cascades with the row and the ex-subscribers become indistinguishable from any other deletion's orphans.
	 * The Product is not among them — its id was never stored, and the drain learns it from a {@code retrieve}
	 * as it archives the first Price.
	 * <li><strong>Delete the row</strong>, which is one statement and the least of it.
	 * </ol>
	 *
	 * <p><strong>Nothing is asked of Stripe here</strong>, which is the half-failure decision ADR-0032 argues
	 * at length: this is N calls to a payment provider inside one HTTP request, and at any real subscriber
	 * count that is a request which times out halfway through cancelling strangers' subscriptions. What the
	 * operator is promised is that the catalog is right the moment they are answered, and that the two systems
	 * agree shortly afterwards.
	 *
	 * @return the catalog as it now stands, or nothing where no tier carries that code
	 */
	@Transactional
	Optional<List<CatalogEntry>> delete(String code) {
		Optional<CatalogEntry> doomed = AdministerTiers.tierFiledUnder(this.catalog, code);
		if (doomed.isEmpty()) {
			return Optional.empty();
		}
		TierId tier = doomed.get().id();
		// The default to land on, unless it is the tier being deleted — in which case there is nowhere to
		// land, and `on delete set null` is what that means in the schema. Read here rather than inside
		// `subscription`, because which tier is the default is the catalog's answer and not that module's.
		Optional<TierId> landing = this.tiers.defaultTier().filter(current -> !current.equals(tier));
		List<String> live = this.subscribers.moveEveryoneOn(tier, landing);
		this.teardown.enqueue(code, StripeCleanup.CANCEL_SUBSCRIPTION, live);
		this.teardown.enqueue(code, StripeCleanup.ARCHIVE_PRICE,
				doomed.get().prices().stream().map(TierPrice::stripePriceId).toList());
		List<CatalogEntry> left = this.catalog.delete(code);
		LOG.warn("The tier `{}` was deleted. {} live Stripe subscription(s) and {} Price(s) are queued for "
				+ "tear-down, and its subscribers are {}.", code, live.size(), doomed.get().prices().size(),
				landing.isPresent() ? "on the default tier" : "on no tier until one is made default");
		return Optional.of(left);
	}

	/**
	 * Move the default flag, and adopt every subscription that names no tier, in one transaction.
	 *
	 * <p><strong>The adoption is precise rather than merely convenient.</strong> A subscription is tier-less
	 * only because no default existed when the tier they were on was deleted, and this route is the sole
	 * writer of the flag — so this is the one moment that stops being true, and everybody heals at once,
	 * including the users who never sign in again. Healing lazily in {@code Subscriptions.currentFor} was the
	 * alternative and is rejected in ADR-0032: it heals one user at a time, only when they show up, which
	 * leaves a catalog that looks repaired and a population that is not.
	 *
	 * <p>The read back is the catalog's, so a form that submits twice is answered with the row as stored both
	 * times.
	 *
	 * @return the tier as it now stands, or nothing where no tier carries that code
	 */
	@Transactional
	Optional<CatalogEntry> makeDefault(String code) {
		Optional<CatalogEntry> made = this.catalog.makeDefault(code);
		made.ifPresent(tier -> {
			int adopted = this.subscribers.adoptOrphansOnto(tier.id());
			// Zero on every ordinary call, so the line is worth reading when it is not: it says how many
			// people an emptied catalog had left without a plan, at the moment they stopped being without one.
			if (adopted > 0) {
				LOG.info("{} subscription(s) naming no tier were adopted onto `{}`, which is now the default.",
						adopted, code);
			}
		});
		return made;
	}

	private final TierCatalog tiers;

	private final TierEdits catalog;

	private final TierTeardown teardown;

	private final TierSubscribers subscribers;

	private static final Logger LOG = LoggerFactory.getLogger(CatalogAndSubscribers.class);

}
