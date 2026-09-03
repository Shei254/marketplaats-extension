package com.mprelist.billing.internal;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.mprelist.billing.NewPlanInStripe;
import com.mprelist.billing.PlanCreation;
import com.mprelist.billing.PlanRhythm;
import com.mprelist.billing.StripePlans;
import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.Price;
import com.stripe.model.Product;
import com.stripe.net.RequestOptions;
import com.stripe.param.PriceCreateParams;
import com.stripe.param.ProductCreateParams;

/**
 * A Product and its recurring Prices, made in Stripe on an operator's say-so (on #84's screen).
 *
 * <p><strong>The tag is the point of the whole exercise.</strong> Each Price carries
 * {@code metadata.tier_code}, which is what makes it indistinguishable from one created by hand in the
 * dashboard — so the sync (T51, #82) adopts it through the path that already exists, and the
 * {@code price.created} Stripe sends moments later finds the row already right.
 *
 * <p><strong>One Product, a Price per rhythm</strong> (T66). Monthly and annual Pro are one plan somebody
 * picks a rhythm for, so they are one Product in Stripe too — creating the plan twice, once per rhythm, would
 * put two identically named Products in the dashboard for an operator to know to ignore.
 *
 * <p><strong>Calls that are not one transaction</strong>, because Stripe has no such thing. A Product created
 * whose Prices then fail leaves an orphan Product in the account: harmless, invisible to this application —
 * nothing reads Products — and cheaper than the alternative, which is deleting it on a failure path that
 * itself can fail. A plan whose <em>second</em> Price fails is a different matter and is answered differently:
 * see {@link PlanCreation.Created}.
 *
 * <p><strong>Idempotent on the caller's key.</strong> Stripe replays the first answer for a repeated
 * idempotency key, which turns a double-submitted form into one Product and one Price per rhythm rather than
 * two of each — the failure this would otherwise have, since nothing else in the sequence can tell a second
 * click from a second plan.
 */
@Service
class CreateStripePlans implements StripePlans {

	CreateStripePlans(StripeAccount stripe) {
		this.stripe = stripe;
	}

	@Override
	public PlanCreation create(NewPlanInStripe plan, String idempotencyKey) {
		Optional<StripeClient> client = this.stripe.client();
		if (client.isEmpty()) {
			return new PlanCreation.Refused("No Stripe API key is configured, so no plan can be created.");
		}
		Product product;
		try {
			product = client.get().products().create(
					ProductCreateParams.builder().setName(plan.name()).build(),
					keyed(idempotencyKey + ":product"));
		}
		catch (StripeException refused) {
			return refusal(plan, refused);
		}

		/*
		 * A Price per rhythm, and the loop keeps going after one is refused. What it is protecting is the
		 * plan that was half made: the rhythms already created are real, tagged, and about to be adopted
		 * whatever is returned here — so the useful answer is what exists, not the first thing that went
		 * wrong. Every refusal is logged with its rhythm, because the caller reports only the shape of what
		 * landed and this is where Stripe's own sentence about the rest can be read.
		 */
		List<PlanCreation.CreatedPrice> made = new ArrayList<>();
		// Every distinct refusal, in order, rather than whichever came last: two rhythms usually fail for the
		// same reason and saying it twice would be noise, but where they differ — an annual amount over a
		// currency's maximum beside a monthly one under its minimum — only one of the two sentences names
		// what the operator has to change, and it is not reliably the last.
		Set<String> refusals = new LinkedHashSet<>();
		for (PlanRhythm rhythm : plan.rhythms()) {
			try {
				Price price = client.get().prices().create(priceFor(plan, product, rhythm),
						keyed(idempotencyKey + ":price:" + rhythm.interval()));
				LOG.info("Created the Stripe Price {} for the tier `{}`, by the {}", price.getId(),
						plan.tierCode(), rhythm.interval());
				made.add(new PlanCreation.CreatedPrice(price.getId(), rhythm.interval()));
			}
			catch (StripeException refused) {
				LOG.warn("Stripe would not price `{}` by the {}: {}", plan.tierCode(), rhythm.interval(),
						refused.getMessage());
				if (refused.getMessage() != null) {
					refusals.add(refused.getMessage());
				}
			}
		}
		if (made.isEmpty()) {
			return refusal(plan, refusals);
		}
		return new PlanCreation.Created(plan.tierCode(), plan.name(), made);
	}

	private static PriceCreateParams priceFor(NewPlanInStripe plan, Product product, PlanRhythm rhythm) {
		return PriceCreateParams.builder()
				.setProduct(product.getId())
				.setCurrency(plan.currency())
				.setUnitAmount(rhythm.amount())
				.setRecurring(PriceCreateParams.Recurring.builder()
						.setInterval(intervalOf(rhythm))
						.build())
				// What the sync adopts on, and the only thing making this a plan rather than a Price.
				.putMetadata(StripeEvent.TIER_CODE, plan.tierCode())
				// Stripe's own name for the Price, which the sync writes onto the tier through a
				// `coalesce` — so the tier is called what the operator typed rather than nothing.
				.setNickname(plan.name())
				.build();
	}

	/**
	 * Stripe's own words: an unsupported currency, an amount below what the currency can charge, a key reused
	 * with a different body. Each names the problem better than a sentence written here, and the person
	 * reading it is an operator rather than a user.
	 */
	private static PlanCreation.Refused refusal(NewPlanInStripe plan, StripeException refused) {
		return refusal(plan, refused == null || refused.getMessage() == null ? Set.of()
				: Set.of(refused.getMessage()));
	}

	/** The same, for the several a plan sold at several rhythms can collect. */
	private static PlanCreation.Refused refusal(NewPlanInStripe plan, Set<String> refusals) {
		LOG.warn("Stripe would not create the plan `{}`: {}", plan.tierCode(),
				refusals.isEmpty() ? "nothing was created" : String.join(" ", refusals));
		// A sentence per refusal, run together — they are already sentences, and joining them keeps the one
		// that names what to change whichever of them it is.
		return new PlanCreation.Refused(refusals.isEmpty() ? "Stripe refused the plan."
				: String.join(" ", refusals));
	}

	/**
	 * The interval, as Stripe's enum spells it.
	 *
	 * <p>Refused rather than defaulted for one Stripe does not have: a plan silently created as monthly when
	 * somebody asked for something else is an amount charged twelve times too often.
	 *
	 * <p><strong>The {@code default} is unreachable and stays anyway.</strong> {@link PlanRhythm} refuses a
	 * recurrence Stripe has no word for at construction, which is where that belongs — an unchecked throw from
	 * here happens mid-creation, after an earlier rhythm's Price may already exist. This is the belt to that
	 * braces: if the two lists ever disagree, the failure should be loud rather than a Price billed at a
	 * rhythm nobody chose.
	 */
	private static PriceCreateParams.Recurring.Interval intervalOf(PlanRhythm rhythm) {
		return switch (rhythm.interval()) {
			case "day" -> PriceCreateParams.Recurring.Interval.DAY;
			case "week" -> PriceCreateParams.Recurring.Interval.WEEK;
			case "month" -> PriceCreateParams.Recurring.Interval.MONTH;
			case "year" -> PriceCreateParams.Recurring.Interval.YEAR;
			default -> throw new IllegalArgumentException("Stripe bills by day, week, month or year, not by "
					+ rhythm.interval());
		};
	}

	/**
	 * A key per call, derived from one, because Stripe scopes a key to the request body: reusing the exact
	 * same key across calls makes the later ones replay the first's answer — which for two Prices would be
	 * one Price returned twice, and a plan whose annual button charged the monthly amount.
	 */
	private static RequestOptions keyed(String idempotencyKey) {
		return RequestOptions.builder().setIdempotencyKey(idempotencyKey).build();
	}

	private final StripeAccount stripe;

	private static final Logger LOG = LoggerFactory.getLogger(CreateStripePlans.class);

}
