package com.mprelist.billing.internal;

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
import com.stripe.model.checkout.Session;
import com.stripe.param.checkout.SessionCreateParams;

/**
 * Opening a Stripe Checkout session for somebody who has chosen a plan (T19, #29).
 *
 * <p><strong>You can only buy what the cards show.</strong> The tier is looked up in
 * {@link TierCatalog#published()} — the same list {@code GET /api/plans} renders — rather than by a query of
 * its own, so "published, and carrying a Price" is decided in exactly one place. A draft synced at quota 0
 * before anybody said what it grants is therefore unbuyable by construction rather than by a second `where`
 * clause remembering to say so (ADR-0019).
 *
 * <p><strong>A returning subscriber is the same customer.</strong> ADR-0018 has a cancelled subscriber fall
 * back to the free tier with {@code stripe_customer_id} kept, precisely so that resubscribing continues one
 * billing history instead of starting a second. So an existing customer id is passed to Stripe when we have
 * one, and only somebody who has never paid arrives at Checkout as a stranger.
 *
 * <p><strong>Every session carries our own account id, twice.</strong> Once as {@code client_reference_id},
 * which is what the Stripe dashboard shows beside the payment, and once as {@code metadata.app_user_id} on the
 * <em>subscription</em> the session creates — which is the one the webhook (T20, #30) actually pulls on. The
 * difference is how long each lasts: a session is a moment and is reported once, while the subscription's own
 * metadata rides every event about it for the whole of its life, including the cancellation three months later
 * when there is no session left to look at. Either way it is our own id, because the alternative is matching
 * on an email address, which this application deliberately does not hold (#108). Nothing else about the person
 * is sent — not their name, not their address, and Stripe collects what it needs itself.
 *
 * <p>Which payment methods are offered — iDEAL, SEPA, PayPal and card for a Dutch marketplace (ADR-0006) —
 * is a setting on the Stripe account rather than a parameter here (T22, #28). Naming them in code would mean
 * a deploy to add one, and would put a second answer beside the dashboard's.
 *
 * <p><strong>Since T65 (#137) the plan screen tells a buyer what those methods are, and it is not the second
 * answer that warns against</strong>: it is read from the same dashboard setting when the cards are drawn,
 * rather than written down a second time. It is also the reason no {@code payment_method_configuration} is
 * set below and none should be — the session takes the account's default, which is the very configuration
 * {@code CachedPaymentMethods} reads, so naming one here would make the sentence and the page it describes
 * disagree. See ADR-0022.
 */
@Service
class OpenCheckout {

	OpenCheckout(TierCatalog catalog, Subscriptions subscriptions, StripeAccount stripe, WebPages web) {
		this.catalog = catalog;
		this.subscriptions = subscriptions;
		this.stripe = stripe;
		this.web = web;
	}

	/**
	 * @param interval which of the tier's rhythms to buy — {@code month} or {@code year} in Stripe's
	 * vocabulary (T62, #128). **A tier code alone no longer names a price**: monthly and annual Pro are one
	 * plan, so the request has to say which one, and a default here would charge somebody yearly because a
	 * client forgot to send a field
	 */
	Checkout open(UserRef buyer, String tierCode, String interval) {
		Optional<SellablePlan> plan = onSale(tierCode);
		if (plan.isEmpty()) {
			LOG.info("Nothing on sale under the code `{}`, so no Checkout session was opened", tierCode);
			return new Checkout.NotForSale();
		}
		Optional<TierPrice> price = plan.get().prices().stream()
				.filter(sold -> sold.interval().equals(interval))
				.findFirst();
		if (price.isEmpty()) {
			// The same answer as an unknown code, and for the same reason: a client holding yesterday's cards
			// is asking for a rhythm this tier no longer sells, which is nobody's error.
			LOG.info("The tier `{}` is not sold by the {}, so no Checkout session was opened", tierCode,
					interval);
			return new Checkout.NotForSale();
		}
		Optional<StripeClient> client = this.stripe.client();
		if (client.isEmpty()) {
			return new Checkout.Unavailable();
		}
		try {
			Session session = client.get().checkout().sessions().create(sessionFor(buyer, price.get()));
			return new Checkout.Opened(session.getUrl());
		}
		catch (StripeException unavailable) {
			// The message, not the exception: it names the failure Stripe reported, and the stack is their
			// client's rather than anything of ours.
			LOG.warn("Could not open a Checkout session for `{}`: {}", tierCode, unavailable.getMessage());
			return new Checkout.Unavailable();
		}
	}

	private Optional<SellablePlan> onSale(String tierCode) {
		return this.catalog.published().stream()
				.filter(plan -> plan.tier().code().equals(tierCode))
				.findFirst();
	}

	/**
	 * The session, and the four things it has to say.
	 *
	 * <p>{@code success_url} and {@code cancel_url} point at {@code apps/web}'s public pages (T50, #81), which
	 * carry no authentication at all — the browser Stripe redirects is not one this application knows
	 * anything about, and the page it lands on deliberately learns nothing either (ADR-0017). Which pages
	 * those are is {@link WebPages}', so that this module's copy of {@code apps/web/src/routes.ts} is one
	 * copy rather than one per call site.
	 */
	private SessionCreateParams sessionFor(UserRef buyer, TierPrice price) {
		SessionCreateParams.Builder session = SessionCreateParams.builder()
				.setMode(SessionCreateParams.Mode.SUBSCRIPTION)
				.addLineItem(SessionCreateParams.LineItem.builder()
						.setPrice(price.stripePriceId())
						.setQuantity(1L)
						.build())
				.setSuccessUrl(this.web.paymentLanded())
				.setCancelUrl(this.web.paymentAbandoned())
				.setClientReferenceId(buyer.id().toString())
				// Copied by Stripe onto the subscription this session creates, and carried by every event
				// about it from then on — which is what lets the mirror (T20, #30) know whose plan moved
				// without holding anything about the person and without depending on the order Stripe
				// happens to deliver a purchase's events in.
				.setSubscriptionData(SessionCreateParams.SubscriptionData.builder()
						.putMetadata(ACCOUNT_TAG, buyer.id().toString())
						.build());
		this.subscriptions.stripeCustomerFor(buyer).ifPresent(session::setCustomer);
		return session.build();
	}

	private final TierCatalog catalog;

	private final Subscriptions subscriptions;

	private final StripeAccount stripe;

	private final WebPages web;

	/**
	 * The metadata key our own account id travels under, defined where it is written and read from where it
	 * is read ({@code StripeEvent}) — one fact with one home, like ADR-0019's {@code tier_code}.
	 *
	 * <p>Spelled as the column it names, because the person who will one day read it is an operator looking at
	 * a subscription in the Stripe dashboard and then at a row in our own database.
	 */
	static final String ACCOUNT_TAG = "app_user_id";

	private static final Logger LOG = LoggerFactory.getLogger(OpenCheckout.class);

}
