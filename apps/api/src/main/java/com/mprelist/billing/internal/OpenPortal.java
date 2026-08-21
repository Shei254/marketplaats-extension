package com.mprelist.billing.internal;

import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.mprelist.identity.UserRef;
import com.mprelist.subscription.Subscriptions;
import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.billingportal.Session;
import com.stripe.param.billingportal.SessionCreateParams;

/**
 * Opening a Stripe Customer Portal session for somebody who wants to change their card, read an invoice or
 * cancel (T21, #31).
 *
 * <p><strong>Nothing about billing is built here, and that is the decision rather than a shortcut.</strong>
 * ADR-0006 chose Stripe for the hosted lifecycle, and the Portal is the whole of it: payment methods,
 * invoices, proration and cancellation are pages Stripe serves, configured in its dashboard. What this API
 * contributes is one thing nobody else can — which Stripe customer the caller's token belongs to.
 *
 * <p><strong>The customer id is the whole of the question.</strong> It is on the subscriber's row because
 * Checkout put it there (T19, #29) and the webhook keeps it there (T20, #30), including through a
 * cancellation: ADR-0018 clears {@code stripe_subscription_id} and keeps {@code stripe_customer_id}, so
 * somebody who cancelled last month still reaches their invoices and their card. Only an account that has
 * never paid has nothing here, and for that one there is genuinely no Portal to open.
 *
 * <p>The subscription's own status is deliberately not consulted. A subscriber in dunning is the person most
 * likely to want this — the 402 copy ADR-0018 asks for is "update your card" beside this very link — and a
 * cancelled one is the second most likely. Gating on status would close the door on both.
 */
@Service
class OpenPortal {

	OpenPortal(Subscriptions subscriptions, StripeAccount stripe, WebPages web) {
		this.subscriptions = subscriptions;
		this.stripe = stripe;
		this.web = web;
	}

	Portal open(UserRef subscriber) {
		Optional<String> customer = this.subscriptions.stripeCustomerFor(subscriber);
		if (customer.isEmpty()) {
			LOG.info("The account {} has never been billed, so there is no Customer Portal to open for it",
					subscriber.id());
			return new Portal.NothingToManage();
		}
		Optional<StripeClient> client = this.stripe.client();
		if (client.isEmpty()) {
			return new Portal.Unavailable();
		}
		try {
			Session session = client.get().billingPortal().sessions().create(SessionCreateParams.builder()
					.setCustomer(customer.get())
					// Where Stripe's own "return" link goes. Not the success page: the commonest reason to be
					// here is cancelling, and congratulating somebody for it would be the wrong screen.
					.setReturnUrl(this.web.billingManaged())
					.build());
			return new Portal.Opened(session.getUrl());
		}
		catch (StripeException unavailable) {
			// The message, not the exception: it names the failure Stripe reported, and the stack is their
			// client's rather than anything of ours. The likeliest one on a fresh account is that nobody has
			// saved the Portal's settings in the dashboard yet, which Stripe says in exactly these words.
			LOG.warn("Could not open a Customer Portal session for the customer {}: {}", customer.get(),
					unavailable.getMessage());
			return new Portal.Unavailable();
		}
	}

	private final Subscriptions subscriptions;

	private final StripeAccount stripe;

	private final WebPages web;

	private static final Logger LOG = LoggerFactory.getLogger(OpenPortal.class);

}
