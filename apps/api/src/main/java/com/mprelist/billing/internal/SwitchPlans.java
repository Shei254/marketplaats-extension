package com.mprelist.billing.internal;

import java.time.Instant;
import java.time.ZoneOffset;
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
import com.stripe.model.SubscriptionSchedule;
import com.stripe.param.InvoiceCreatePreviewParams;
import com.stripe.param.SubscriptionScheduleCreateParams;
import com.stripe.param.SubscriptionScheduleUpdateParams;
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
 * Customer Portal no longer switches anything (T90).
 *
 * <p><strong>A switch buys a fresh period, now or at renewal</strong> (T90, ADR-0042). Now is
 * {@code billing_cycle_anchor=now} with {@code proration_behavior=none}: the new plan's full price is charged
 * today, nothing of the old one is credited, and Stripe's new window starts a fresh Quota period with its full
 * grant. Each grant is paid for in full once, so switching back and forth buys nothing. At renewal is a
 * Subscription Schedule: the current Price until Stripe's period ends, then the chosen one. At most one is
 * pending, so a schedule already there is released before either kind is made, and Stripe would otherwise
 * rewrite that schedule's phases under an update rather than refuse it (checked in test mode, 2026-11-12).
 * The tier follows the Price through the webhook, and the pending switch through the schedule's own.
 * Releasing first has one cost, accepted in ADR-0042: a switch now that is left at 3-D Secure has already
 * dropped a pending Scheduled switch, and nothing re-makes it.
 *
 * <p><strong>Not during Dunning.</strong> Stripe's status, read on the call that fetches the subscription, is
 * {@code past_due}, {@code unpaid} or {@code incomplete}: the open invoice comes first, and nothing is priced.
 * A {@code past_due} whose invoice is being paid is not Dunning ({@link InvoicesBeingPaid}): a SEPA payer who
 * switched minutes ago may switch again.
 *
 * <p><strong>Waiting for the money, where Stripe can</strong> (ADR-0036, amended 2026-11-12). For a method on
 * Stripe's pending-updates list, {@code pending_if_incomplete} means nothing moves until the money has: a
 * payment that needs the payer leaves the subscription where it was, with the invoice's hosted page to finish
 * it on. Stripe refuses that outright for anything else, every bank debit included ("You cannot set
 * {@code payment_behavior} to {@code pending_if_incomplete} when the default payment method is
 * {@code sepa_debit}"), so those switch at once with {@code allow_incomplete} and are collected afterwards, as
 * Checkout already trusts a first SEPA subscriber. Stripe answers {@code past_due} while the debit is still
 * processing (seen in test mode, 2026-11-12), so {@code past_due} alone does not mean the payer has to act: a
 * PaymentIntent that is {@code processing} is a switch made ({@link InvoicesBeingPaid}). One that needs the payer — BLIK, MB Way — goes to
 * the same hosted page. One that fails is Dunning.
 *
 * <p><strong>The preview is Stripe's</strong>, the same call with the same items, so the amount a confirmation
 * dialog shows is the one Stripe computed rather than one we did. With nothing prorated, the two agree.
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
							.setBillingCycleAnchor(
									InvoiceCreatePreviewParams.SubscriptionDetails.BillingCycleAnchor.NOW)
							.setProrationBehavior(InvoiceCreatePreviewParams.SubscriptionDetails.ProrationBehavior.NONE)
							.build())
					.build());
			return new PlanSwitch.Previewed(preview.getTotal(), preview.getCurrency(),
					Instant.ofEpochSecond(itemOf(current).getCurrentPeriodEnd()).atOffset(ZoneOffset.UTC));
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
			releaseAnyScheduleOn(client, current);
			Subscription updated = client.subscriptions().update(current.getId(), SubscriptionUpdateParams.builder()
					.addItem(SubscriptionUpdateParams.Item.builder()
							.setId(item.getId())
							.setPrice(price.stripePriceId())
							.build())
					.setBillingCycleAnchor(SubscriptionUpdateParams.BillingCycleAnchor.NOW)
					.setProrationBehavior(SubscriptionUpdateParams.ProrationBehavior.NONE)
					.setPaymentBehavior(stripeCanWaitFor(current)
							? SubscriptionUpdateParams.PaymentBehavior.PENDING_IF_INCOMPLETE
							: SubscriptionUpdateParams.PaymentBehavior.ALLOW_INCOMPLETE)
					.addExpand("latest_invoice.payments")
					.build());
			boolean held = updated.getPendingUpdate() != null;
			if (!held && !PAST_DUE.equals(updated.getStatus())) {
				LOG.info("Switched a subscription to `{}` ({})", tierCode, interval);
				return new PlanSwitch.Switched();
			}
			Invoice owed = updated.getLatestInvoiceObject();
			if (!held && InvoicesBeingPaid.beingPaid(client, owed)) {
				// A bank debit on its way: Stripe says `past_due` until it clears, but there is nothing for the
				// payer to do, and the invoice's page would only tell them so.
				LOG.info("Switched a subscription to `{}` ({}); the payment is being collected", tierCode, interval);
				return new PlanSwitch.Switched();
			}
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

	/**
	 * A <strong>Scheduled switch</strong>: the Price they pay now until Stripe's period ends, then the chosen
	 * one (T90, ADR-0042). Charges nothing today. Choosing the Price they already pay drops what was pending,
	 * which is all that can mean.
	 *
	 * @param who whoever the token names
	 * @param tierCode the plan, by its stable handle
	 * @param interval the Rhythm, in Stripe's vocabulary
	 */
	PlanSwitch schedule(UserRef who, String tierCode, String interval) {
		return target(who, tierCode, interval, (client, current, price) -> {
			releaseAnyScheduleOn(client, current);
			SubscriptionItem item = itemOf(current);
			if (item.getPrice() != null && price.stripePriceId().equals(item.getPrice().getId())) {
				return new PlanSwitch.Switched();
			}
			SubscriptionSchedule made = client.subscriptionSchedules().create(
					SubscriptionScheduleCreateParams.builder().setFromSubscription(current.getId()).build());
			// Stripe's own copy of the period they are in, so its end is the one Stripe will renew on.
			SubscriptionSchedule.Phase now = made.getPhases().getFirst();
			SubscriptionSchedule scheduled = client.subscriptionSchedules().update(made.getId(),
					SubscriptionScheduleUpdateParams.builder()
						.setEndBehavior(SubscriptionScheduleUpdateParams.EndBehavior.RELEASE)
						.addPhase(SubscriptionScheduleUpdateParams.Phase.builder()
							.addItem(SubscriptionScheduleUpdateParams.Phase.Item.builder()
								.setPrice(now.getItems().getFirst().getPrice())
								.setQuantity(1L)
								.build())
							.setStartDate(now.getStartDate())
							.setEndDate(now.getEndDate())
							.build())
						.addPhase(SubscriptionScheduleUpdateParams.Phase.builder()
							.addItem(SubscriptionScheduleUpdateParams.Phase.Item.builder()
								.setPrice(price.stripePriceId())
								.setQuantity(1L)
								.build())
							.setIterations(1L)
							.setProrationBehavior(SubscriptionScheduleUpdateParams.Phase.ProrationBehavior.NONE)
							.build())
						.build());
			LOG.info("Scheduled a switch to `{}` ({}) for the end of the period", tierCode, interval);
			return new PlanSwitch.Scheduled(
					Instant.ofEpochSecond(scheduled.getPhases().getFirst().getEndDate()).atOffset(ZoneOffset.UTC));
		});
	}

	/**
	 * <strong>Ongedaan maken</strong>: the pending Scheduled switch released, so the subscription renews at the
	 * Price it has. Nothing pending is nothing to do, which a second click or a webhook that got there first
	 * both are.
	 *
	 * @param who whoever the token names
	 */
	PlanSwitch undo(UserRef who) {
		// Not refused during Dunning: undo charges nothing, and it is the way out of a cancel the Portal refuses
		// while a schedule holds the subscription (ADR-0042).
		return onStripe(who, "undo a scheduled switch", false, (client, current) -> {
			releaseAnyScheduleOn(client, current);
			return new PlanSwitch.Switched();
		});
	}

	/** The refusals every call shares, in the order {@code OpenCheckout} asks its own: the caller, the plan, Stripe. */
	private PlanSwitch target(UserRef who, String tierCode, String interval, OnStripe then) {
		if (this.subscriptions.stripeSubscriptionFor(who).isEmpty()) {
			return new PlanSwitch.NotPaying();
		}
		Optional<TierPrice> price = onSale(tierCode, interval);
		if (price.isEmpty()) {
			LOG.info("Nothing on sale as `{}` ({}), so no subscription was switched", tierCode, interval);
			return new PlanSwitch.NotForSale();
		}
		return onStripe(who, "switch or price a switch to `" + tierCode + "` (" + interval + ")", true,
				(client, current) -> then.ask(client, current, price.get()));
	}

	/**
	 * Their subscription, fetched, and — for a switch — refused during Dunning before anything else is asked of
	 * Stripe.
	 */
	private PlanSwitch onStripe(UserRef who, String what, boolean refusedDuringDunning, OnTheirs then) {
		Optional<String> subscription = this.subscriptions.stripeSubscriptionFor(who);
		if (subscription.isEmpty()) {
			return new PlanSwitch.NotPaying();
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
						.addExpand("latest_invoice.payments")
						.build(),
					null);
			if (refusedDuringDunning && DUNNING.contains(current.getStatus())
					&& !(PAST_DUE.equals(current.getStatus())
							&& InvoicesBeingPaid.beingPaid(client.get(), current.getLatestInvoiceObject()))) {
				LOG.info("Did not {}: the subscription is `{}`, so its open invoice comes first", what,
						current.getStatus());
				return new PlanSwitch.InvoiceOpen();
			}
			return then.ask(client.get(), current);
		}
		catch (StripeException unavailable) {
			LOG.warn("Could not {}: {}", what, unavailable.getMessage());
			return new PlanSwitch.Unavailable();
		}
	}

	/** At most one switch is pending, so whatever is about to be made replaces it. */
	private static void releaseAnyScheduleOn(StripeClient client, Subscription current) throws StripeException {
		if (current.getSchedule() != null) {
			client.subscriptionSchedules().release(current.getSchedule());
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

	@FunctionalInterface
	private interface OnTheirs {

		PlanSwitch ask(StripeClient client, Subscription current) throws StripeException;

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


	/** Dunning, as Stripe spells it: an invoice is open and being collected (ADR-0018, ADR-0042). */
	private static final Set<String> DUNNING = Set.of(PAST_DUE, "unpaid", "incomplete");

}
