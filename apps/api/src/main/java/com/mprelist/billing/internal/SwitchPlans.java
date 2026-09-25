package com.mprelist.billing.internal;

import java.util.List;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.mprelist.catalog.SellablePlan;
import com.mprelist.catalog.TierCatalog;
import com.mprelist.catalog.TierPrice;
import com.mprelist.identity.UserRef;
import com.mprelist.subscription.Subscriptions;
import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.Invoice;
import com.stripe.model.Subscription;
import com.stripe.model.SubscriptionItem;
import com.stripe.param.InvoiceCreatePreviewParams;
import com.stripe.param.SubscriptionUpdateParams;

/**
 * A <strong>Plan switch</strong>: the Price on the Stripe subscription somebody already has, changed in place
 * (T85, ADR-0036).
 *
 * <p><strong>Why not a second Checkout.</strong> There is one subscription row per user, and Stripe's events
 * find it by account or customer rather than by subscription. Two live subscriptions are therefore two
 * charges against one row, and the old one's end drops the holder to the default tier while the new one is
 * still billing. T83 refuses the second Checkout; this is what the site offers instead. The popup's door is the
 * Customer Portal, which does the same thing on Stripe's page.
 *
 * <p><strong>Immediate and prorated both ways</strong> — {@code always_invoice}. An upgrade is charged the
 * difference now; a downgrade's negative invoice becomes a credit on the Stripe customer, used against the
 * next ones. {@code pending_if_incomplete} means nothing moves until the money has: a payment that needs the
 * payer leaves the subscription where it was, with the invoice's hosted page to finish it on. The tier then
 * follows the Price through the webhook, which already reads the tier off whatever Price Stripe reports.
 *
 * <p><strong>The preview is Stripe's</strong>, the same call with the same items, so the amount a confirmation
 * dialog shows is the one Stripe computed rather than one we did. The two are made seconds apart and can differ
 * by those seconds' proration; pinning a {@code proration_date} between them would close that, and is state
 * this does not otherwise need.
 */
@Service
class SwitchPlans {

	SwitchPlans(TierCatalog catalog, Subscriptions subscriptions, StripeAccount stripe) {
		this.catalog = catalog;
		this.subscriptions = subscriptions;
		this.stripe = stripe;
	}

	/**
	 * What switching to that plan at that rhythm would invoice now. Spends nothing.
	 *
	 * @param who whoever the token names
	 * @param tierCode the plan, by its stable handle
	 * @param interval the Rhythm, in Stripe's vocabulary
	 */
	PlanSwitch preview(UserRef who, String tierCode, String interval) {
		return target(who, tierCode, interval, (client, current, price) -> {
			Invoice preview = client.invoices().createPreview(InvoiceCreatePreviewParams.builder()
					.setSubscription(current.getId())
					.setSubscriptionDetails(InvoiceCreatePreviewParams.SubscriptionDetails.builder()
							.addItem(InvoiceCreatePreviewParams.SubscriptionDetails.Item.builder()
									.setId(itemOf(current).getId())
									.setPrice(price.stripePriceId())
									.build())
							.setProrationBehavior(
									InvoiceCreatePreviewParams.SubscriptionDetails.ProrationBehavior.ALWAYS_INVOICE)
							.build())
					.build());
			return new PlanSwitch.Previewed(preview.getTotal(), preview.getCurrency());
		});
	}

	/**
	 * Switch, now. The caller has confirmed the amount {@link #preview} showed them.
	 *
	 * @param who whoever the token names
	 * @param tierCode the plan, by its stable handle
	 * @param interval the Rhythm, in Stripe's vocabulary
	 */
	PlanSwitch apply(UserRef who, String tierCode, String interval) {
		return target(who, tierCode, interval, (client, current, price) -> {
			SubscriptionItem item = itemOf(current);
			if (item.getPrice() != null && price.stripePriceId().equals(item.getPrice().getId())) {
				// Already billed at it: a second click, or a card drawn before the webhook landed. Nothing to
				// charge, and "not for sale" would be untrue.
				return new PlanSwitch.Switched();
			}
			Subscription updated = client.subscriptions().update(current.getId(), SubscriptionUpdateParams.builder()
					.addItem(SubscriptionUpdateParams.Item.builder()
							.setId(item.getId())
							.setPrice(price.stripePriceId())
							.build())
					.setProrationBehavior(SubscriptionUpdateParams.ProrationBehavior.ALWAYS_INVOICE)
					.setPaymentBehavior(SubscriptionUpdateParams.PaymentBehavior.PENDING_IF_INCOMPLETE)
					.addExpand("latest_invoice")
					.build());
			if (updated.getPendingUpdate() == null) {
				LOG.info("Switched a subscription to `{}` ({})", tierCode, interval);
				return new PlanSwitch.Switched();
			}
			Invoice owed = updated.getLatestInvoiceObject();
			if (owed == null || owed.getHostedInvoiceUrl() == null) {
				// Pending with nowhere to pay it is a switch nobody can finish; say so rather than "done".
				LOG.warn("A switch to `{}` ({}) is pending payment and Stripe named no page to pay it on", tierCode,
						interval);
				return new PlanSwitch.Unavailable();
			}
			LOG.info("A switch to `{}` ({}) is waiting on the payer", tierCode, interval);
			return new PlanSwitch.ConfirmPayment(owed.getHostedInvoiceUrl());
		});
	}

	/** The refusals both calls share, in the order {@code OpenCheckout} asks its own: the caller, the plan, Stripe. */
	private PlanSwitch target(UserRef who, String tierCode, String interval, OnStripe then) {
		Optional<String> subscription = this.subscriptions.stripeSubscriptionFor(who);
		if (subscription.isEmpty()) {
			return new PlanSwitch.NotPaying();
		}
		Optional<TierPrice> price = onSale(tierCode, interval);
		if (price.isEmpty()) {
			LOG.info("Nothing on sale as `{}` ({}), so no subscription was switched", tierCode, interval);
			return new PlanSwitch.NotForSale();
		}
		Optional<StripeClient> client = this.stripe.client();
		if (client.isEmpty()) {
			return new PlanSwitch.Unavailable();
		}
		try {
			Subscription current = client.get().subscriptions().retrieve(subscription.get());
			return then.ask(client.get(), current, price.get());
		}
		catch (StripeException unavailable) {
			LOG.warn("Could not switch or price a switch to `{}` ({}): {}", tierCode, interval,
					unavailable.getMessage());
			return new PlanSwitch.Unavailable();
		}
	}

	private Optional<TierPrice> onSale(String tierCode, String interval) {
		return this.catalog.published().stream()
				.filter(plan -> plan.tier().code().equals(tierCode))
				.map(SellablePlan::prices)
				.flatMap(List::stream)
				.filter(sold -> sold.interval().equals(interval))
				.findFirst();
	}

	/**
	 * The one item every subscription here has: Checkout sells a single line item, quantity 1, and nothing
	 * adds another.
	 */
	private static SubscriptionItem itemOf(Subscription subscription) {
		return subscription.getItems().getData().getFirst();
	}

	@FunctionalInterface
	private interface OnStripe {

		PlanSwitch ask(StripeClient client, Subscription current, TierPrice price) throws StripeException;

	}

	private final TierCatalog catalog;

	private final Subscriptions subscriptions;

	private final StripeAccount stripe;

	private static final Logger LOG = LoggerFactory.getLogger(SwitchPlans.class);

}
