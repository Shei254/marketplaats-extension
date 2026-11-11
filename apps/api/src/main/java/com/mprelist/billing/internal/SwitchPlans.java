package com.mprelist.billing.internal;

import java.util.List;
import java.util.Optional;
import java.util.Set;

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
import com.stripe.model.Customer;
import com.stripe.model.Invoice;
import com.stripe.model.PaymentMethod;
import com.stripe.model.Subscription;
import com.stripe.model.SubscriptionItem;
import com.stripe.param.InvoiceCreatePreviewParams;
import com.stripe.param.SubscriptionRetrieveParams;
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
 * next ones. The tier follows the Price through the webhook, which already reads the tier off whatever Price
 * Stripe reports.
 *
 * <p><strong>Waiting for the money, where Stripe can</strong> (ADR-0036, amended 2026-11-12). For a method on
 * Stripe's pending-updates list, {@code pending_if_incomplete} means nothing moves until the money has: a
 * payment that needs the payer leaves the subscription where it was, with the invoice's hosted page to finish
 * it on. Stripe refuses that outright for anything else, every bank debit included ("You cannot set
 * {@code payment_behavior} to {@code pending_if_incomplete} when the default payment method is
 * {@code sepa_debit}"), so those switch at once with {@code allow_incomplete} and are collected afterwards, as
 * Checkout already trusts a first SEPA subscriber. One that then needs the payer comes back {@code past_due}
 * and goes to the same hosted page. One that fails is Dunning.
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
					.setPaymentBehavior(stripeCanWaitFor(current)
							? SubscriptionUpdateParams.PaymentBehavior.PENDING_IF_INCOMPLETE
							: SubscriptionUpdateParams.PaymentBehavior.ALLOW_INCOMPLETE)
					.addExpand("latest_invoice")
					.build());
			boolean held = updated.getPendingUpdate() != null;
			if (!held && !PAST_DUE.equals(updated.getStatus())) {
				LOG.info("Switched a subscription to `{}` ({})", tierCode, interval);
				return new PlanSwitch.Switched();
			}
			Invoice owed = updated.getLatestInvoiceObject();
			if (!held && (owed == null || owed.getHostedInvoiceUrl() == null)) {
				// Switched already, and Dunning has it from here; "unavailable" would be untrue.
				LOG.warn("Switched a subscription to `{}` ({}), now past due with no page to pay it on", tierCode,
						interval);
				return new PlanSwitch.Switched();
			}
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
			Subscription current = client.get().subscriptions().retrieve(subscription.get(),
					SubscriptionRetrieveParams.builder()
						.addExpand("default_payment_method")
						.addExpand("customer.invoice_settings.default_payment_method")
						.build(),
					null);
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
	 * Whether Stripe can hold a switch until it is paid: whether the method it will charge is on its
	 * pending-updates list. That is the subscription's own default, else the customer's invoice default. No
	 * method at all is not on the list.
	 */
	private static boolean stripeCanWaitFor(Subscription subscription) {
		PaymentMethod method = subscription.getDefaultPaymentMethodObject();
		if (method == null) {
			Customer customer = subscription.getCustomerObject();
			if (customer != null && customer.getInvoiceSettings() != null) {
				method = customer.getInvoiceSettings().getDefaultPaymentMethodObject();
			}
		}
		return method != null && PENDING_UPDATES.contains(method.getType());
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

	/**
	 * Stripe's pending-updates list, as {@code PaymentMethod.type}, from
	 * https://docs.stripe.com/billing/subscriptions/pending-updates on 2026-11-12. Apple Pay and Google Pay
	 * arrive as {@code card}. NG Card is listed there under a type name this was not sure of, so it is left out.
	 * A method missing from here switches at once rather than failing to switch, so a stale copy is never stuck.
	 */
	private static final Set<String> PENDING_UPDATES = Set.of("card", "link", "alipay", "amazon_pay",
			"afterpay_clearpay", "cashapp", "eps", "gopay", "kakao_pay", "klarna", "kr_card", "naver_pay", "paypal",
			"payto", "pix", "promptpay", "revolut_pay", "satispay", "crypto", "swish", "twint", "upi", "wechat_pay");

	private static final String PAST_DUE = "past_due";

}
