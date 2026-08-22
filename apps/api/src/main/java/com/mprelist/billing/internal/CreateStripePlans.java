package com.mprelist.billing.internal;

import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.mprelist.billing.NewPlanInStripe;
import com.mprelist.billing.PlanCreation;
import com.mprelist.billing.StripePlans;
import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.Price;
import com.stripe.model.Product;
import com.stripe.net.RequestOptions;
import com.stripe.param.PriceCreateParams;
import com.stripe.param.ProductCreateParams;

/**
 * A Product and a recurring Price, made in Stripe on an operator's say-so (on #84's screen).
 *
 * <p><strong>The tag is the point of the whole exercise.</strong> The Price carries
 * {@code metadata.tier_code}, which is what makes it indistinguishable from one created by hand in the
 * dashboard — so the sync (T51, #82) adopts it through the path that already exists, and the
 * {@code price.created} Stripe sends moments later finds the row already right.
 *
 * <p><strong>Two calls that are not one transaction</strong>, because Stripe has no such thing. A Product
 * created whose Price then fails leaves an orphan Product in the account: harmless, invisible to this
 * application — nothing reads Products — and cheaper than the alternative, which is deleting it on a failure
 * path that itself can fail. The operator retries and gets a second Product; the tier is made by the Price,
 * and there is only ever one of those.
 *
 * <p><strong>Idempotent on the caller's key.</strong> Stripe replays the first answer for a repeated
 * idempotency key, which turns a double-submitted form into one Product and one Price rather than two of
 * each — the failure this would otherwise have, since nothing else in the sequence can tell a second click
 * from a second plan.
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
		try {
			Product product = client.get().products().create(
					ProductCreateParams.builder().setName(plan.name()).build(),
					keyed(idempotencyKey + ":product"));
			Price price = client.get().prices().create(PriceCreateParams.builder()
					.setProduct(product.getId())
					.setCurrency(plan.currency())
					.setUnitAmount(plan.amount())
					.setRecurring(PriceCreateParams.Recurring.builder()
							.setInterval(intervalOf(plan))
							.build())
					// What the sync adopts on, and the only thing making this a plan rather than a Price.
					.putMetadata(StripeEvent.TIER_CODE, plan.tierCode())
					// Stripe's own name for the Price, which the sync writes onto the tier through a
					// `coalesce` — so the tier is called what the operator typed rather than nothing.
					.setNickname(plan.name())
					.build(), keyed(idempotencyKey + ":price"));
			LOG.info("Created the Stripe Price {} for the tier `{}`", price.getId(), plan.tierCode());
			return new PlanCreation.Created(price.getId(), plan.tierCode(), plan.name());
		}
		catch (StripeException refused) {
			// Stripe's own words: an unsupported currency, an amount below what the currency can charge, a
			// key reused with a different body. Each names the problem better than a sentence written here,
			// and the person reading it is an operator rather than a user.
			LOG.warn("Stripe would not create the plan `{}`: {}", plan.tierCode(), refused.getMessage());
			return new PlanCreation.Refused(
					refused.getMessage() == null ? "Stripe refused the plan." : refused.getMessage());
		}
	}

	/**
	 * The interval, as Stripe's enum spells it.
	 *
	 * <p>Refused rather than defaulted for one Stripe does not have: a plan silently created as monthly when
	 * somebody asked for something else is an amount charged twelve times too often.
	 */
	private static PriceCreateParams.Recurring.Interval intervalOf(NewPlanInStripe plan) {
		return switch (plan.interval()) {
			case "day" -> PriceCreateParams.Recurring.Interval.DAY;
			case "week" -> PriceCreateParams.Recurring.Interval.WEEK;
			case "month" -> PriceCreateParams.Recurring.Interval.MONTH;
			case "year" -> PriceCreateParams.Recurring.Interval.YEAR;
			default -> throw new IllegalArgumentException("Stripe bills by day, week, month or year, not by "
					+ plan.interval());
		};
	}

	/**
	 * Two calls, two keys derived from one, because Stripe scopes a key to the request body: reusing the
	 * exact same key for the Product and the Price makes the second call replay the first's answer.
	 */
	private static RequestOptions keyed(String idempotencyKey) {
		return RequestOptions.builder().setIdempotencyKey(idempotencyKey).build();
	}

	private final StripeAccount stripe;

	private static final Logger LOG = LoggerFactory.getLogger(CreateStripePlans.class);

}
