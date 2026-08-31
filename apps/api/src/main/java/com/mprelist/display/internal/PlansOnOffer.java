package com.mprelist.display.internal;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.mprelist.billing.StripePaymentMethods;
import com.mprelist.billing.StripePrice;
import com.mprelist.billing.StripePrices;
import com.mprelist.catalog.SellablePlan;
import com.mprelist.catalog.TierCatalog;
import com.mprelist.catalog.TierName;
import com.mprelist.catalog.TierPrice;

/**
 * The plan cards, composed from the two places a plan lives (T49, #80).
 *
 * <p>Our half comes from the tier catalog — what it is called, what it grants — and Stripe's half is the
 * amount, fetched and cached by {@code billing} and never stored (ADR-0014/0019). This is the join, and it is
 * in {@code display} for the reason that module exists at all: it is a view over other modules' answers, and
 * putting it in either of them would point a dependency the wrong way.
 *
 * <p><strong>All of them or none of them.</strong> If any published tier's price cannot be fetched the whole
 * answer is nothing, and the cards render "prices unavailable, retry". Returning the ones that did resolve
 * was the other option and is worse: the plan screen is a <em>comparison</em>, and a buyer cannot tell a plan
 * that is missing from a plan that does not exist — so a partial list is a wrong picture of what is on offer,
 * quietly, at the moment somebody is deciding what to pay for. It is also very nearly always all-or-nothing
 * in practice: an unreachable Stripe fails every call, not one.
 *
 * <p>Empty is not the same as unavailable. A catalog with nothing published answers {@code 200} and an empty
 * list, because that is true — a stack whose Stripe Prices have not been created yet (T22, #28) is selling
 * nothing, and saying "unavailable" would report a fault that is not there.
 *
 * <p><strong>The ways to pay do not join that rule, and the reason is the rule's own reason</strong> (T65,
 * #137). All-or-nothing is argued above from the screen being a <em>comparison</em> — a buyer cannot tell a
 * plan that is missing from a plan that does not exist, so a partial list is a wrong picture. Take the
 * payment methods away and the comparison is untouched: every plan, every rhythm and every amount still says
 * what it says, and all that is lost is a sentence telling somebody they can pay with iDEAL. Blanking a
 * working plan screen to protect that would lose a sale to protect a reassurance, so an empty list here is
 * carried alongside a perfectly good answer rather than turning it into a {@code 503}.
 */
@Service
class PlansOnOffer {

	PlansOnOffer(TierCatalog catalog, StripePrices prices, StripePaymentMethods methods) {
		this.catalog = catalog;
		this.prices = prices;
		this.methods = methods;
	}

	/** @return the cards, or nothing at all when any price could not be had */
	Optional<Plans> cards() {
		List<Plan> cards = new ArrayList<>();
		for (SellablePlan sellable : this.catalog.published()) {
			List<PlanPrice> priced = new ArrayList<>();
			for (TierPrice sold : sellable.prices()) {
				Optional<StripePrice> price = this.prices.of(sold.stripePriceId());
				if (price.isEmpty()) {
					LOG.warn("Not rendering any plan: Stripe could not price {} ({}), and a partial list of "
							+ "what is on offer is a wrong one", sellable.tier().code(), sold.stripePriceId());
					return Optional.empty();
				}
				priced.add(new PlanPrice(price.get().amount(), price.get().currency(), sold.interval()));
			}
			cards.add(new Plan(sellable.tier(), sellable.grants().relistsPerPeriod(),
					sellable.grants().features(), List.copyOf(priced)));
		}
		if (!oneCurrencyThroughout(cards)) {
			return Optional.empty();
		}
		// Asked last and allowed to answer nothing: the cards above are the page, and this is a line under
		// its title.
		return Optional.of(new Plans(List.copyOf(cards), this.methods.offered()));
	}

	/**
	 * Whether every amount on this screen is in the same currency (T63, #129).
	 *
	 * <p><strong>A plan screen is a comparison, and two currencies is not one a buyer can make</strong> —
	 * telling €9,99 from $12.99 needs today's rate. So a mixed catalog is refused whole, exactly as a price
	 * that could not be fetched is: the alternative is a screen that looks fine and asks somebody to choose
	 * between numbers that do not mean the same thing.
	 *
	 * <p>Nothing this API offers can produce one — no request carries a currency, and every plan is created in
	 * the account's own (T63) — so the way here is a Price made directly in the Stripe dashboard, tagged with
	 * a tier code and priced in something else. That is an operator's mistake and this is where it surfaces,
	 * loudly, rather than on a card somebody is deciding what to pay from.
	 */
	private static boolean oneCurrencyThroughout(List<Plan> cards) {
		Set<String> currencies = cards.stream()
				.flatMap(card -> card.prices().stream())
				.map(PlanPrice::currency)
				.collect(Collectors.toCollection(LinkedHashSet::new));
		if (currencies.size() <= 1) {
			return true;
		}
		LOG.error("Not rendering any plan: the catalog is priced in {} at once, and a plan screen a buyer "
				+ "cannot compare is worse than none. A Price created in the Stripe dashboard in another "
				+ "currency is the way here; every plan this API creates uses the account's own.", currencies);
		return false;
	}

	private final TierCatalog catalog;

	private final StripePrices prices;

	private final StripePaymentMethods methods;

	private static final Logger LOG = LoggerFactory.getLogger(PlansOnOffer.class);

	/**
	 * The body {@code docs/enforcement-contract.md} names. A wrapper object rather than a bare array, like
	 * every other answer this API gives: a top-level array is a shape that cannot grow a field — which is
	 * exactly what it did in T65 (#137).
	 *
	 * <p>{@code paymentMethods} is Stripe's own spelling, unedited: {@code ideal}, {@code paypal},
	 * {@code sepa_debit}. What each is <em>called</em> is the popup's, for the reason {@code currency} and
	 * {@code interval} are already sent raw — the client formats, and a display name invented here would be a
	 * second vocabulary travelling beside the first. **Always present and never null**, because empty already
	 * means the one thing a client would do with absent: say nothing.
	 */
	record Plans(List<Plan> plans, List<String> paymentMethods) {
	}

	/**
	 * One card. {@code maxMarktplaatsAccounts} is deliberately not on it — no tier sells more than one until
	 * #47 finds a stable Marktplaats account identifier, so rendering it would be advertising something
	 * nothing can yet tell apart.
	 */
	record Plan(TierName tier, int relistQuotaPerPeriod, Map<String, Object> features, List<PlanPrice> prices) {
	}

	/**
	 * One rhythm a plan may be bought at (T62, #128) — what it costs and how often.
	 *
	 * <p><strong>The interval is ours and the rest is Stripe's</strong>, which is why this is not
	 * {@link StripePrice} itself. Stripe reports a recurrence on the Price too, and the two always agree; what
	 * is sent is the catalog's, because that is the value a Checkout request will name back at us and the two
	 * must be the same string. A card built from Stripe's spelling and a request matched against ours is a
	 * bug that only shows on whichever rhythm somebody clicks second.
	 */
	record PlanPrice(long amount, String currency, String interval) {
	}

}
