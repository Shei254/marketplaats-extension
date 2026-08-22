package com.mprelist.billing.internal;

import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.mprelist.subscription.Mirroring;
import com.mprelist.subscription.QuotaPeriod;
import com.mprelist.subscription.SubscriberOnStripe;
import com.mprelist.subscription.SubscriptionMirror;
import com.mprelist.subscription.SubscriptionStatus;

/**
 * Where a Stripe subscription event becomes the plan somebody is on (#30, T20) — the half of slice C that
 * turns a payment into an entitlement. Nothing else in this application does: a {@code 200} from
 * {@code POST /api/checkout} is an offer to pay, and this is what happens when Stripe says the money moved.
 *
 * <p><strong>What is read here and what is decided elsewhere.</strong> This class reads an event and nothing
 * more — which subscription, whose, what status, which Price, which window — and hands all of it to
 * {@link SubscriptionMirror}. Which tier that Price sells, whose row it is, whether the event has already been
 * overtaken and what a cancellation does to a subscriber are all statements about our own table, and they are
 * made on that side of the boundary. What is left here is the reading, and the log lines an operator needs
 * when a reading comes to nothing.
 *
 * <p><strong>Everything it cannot act on is a {@code 200} and a log line</strong>, never a refusal. Stripe
 * retries a non-2xx for three days, so answering one over a subscription that belongs to another deployment,
 * a Price nobody tagged, or a status this application has never heard of would bury the events that matter
 * under an endless redelivery of the ones no retry can fix. That is the same posture {@code ReceiveStripeEvents}
 * takes for an operator's mistake on a Price, and for the same reason.
 */
@Service
class MirrorSubscriptions {

	MirrorSubscriptions(SubscriptionMirror mirror) {
		this.mirror = mirror;
	}

	/**
	 * @param event one of the three {@code customer.subscription.*} events, already verified as Stripe's
	 */
	void apply(StripeEvent event) {
		Optional<SubscriberOnStripe> who = event.subscriber();
		if (who.isEmpty()) {
			LOG.error("A {} event named no subscription or no customer, which no event Stripe sends does, so "
					+ "nothing was mirrored ({}).", event.type(), event.id());
			return;
		}
		Optional<SubscriptionStatus> status = event.subscriptionStatus();
		if (status.isEmpty()) {
			// Loud, because the subscriber is left on whatever they were on: if `paused` — or whatever Stripe
			// adds next — ever becomes something this product offers, this line is the only thing that says the
			// mirror stopped following them.
			LOG.error("Stripe reports the subscription {} as `{}`, which is not one of the seven statuses this "
					+ "application stores, so its plan was left exactly as it was. Widening "
					+ "subscription_status_check and SubscriptionStatus together is what teaches it that word.",
					who.get().subscriptionId(), event.statusAsStripeSpellsIt());
			return;
		}
		if (status.get().endsTheSubscription()) {
			// No Price and no period are read on this path, deliberately: ending something needs neither, and
			// a cancellation that could fail to be read is the one event that must never fail to land.
			report(this.mirror.ended(who.get(), event.created()), who.get(), event);
			return;
		}
		Optional<String> price = event.subscribedPriceId();
		Optional<QuotaPeriod> period = event.billingPeriod();
		if (price.isEmpty() || period.isEmpty()) {
			LOG.error("Stripe reports the subscription {} as `{}` but the event carries {}, so there is nothing "
					+ "to put anybody on and the plan was left as it was. This is the shape of a Stripe API "
					+ "version whose subscriptions this build cannot read.", who.get().subscriptionId(),
					status.get(), price.isEmpty() ? "no Price on its first item" : "no billing period");
			return;
		}
		report(this.mirror.mirror(who.get(), status.get(), price.get(), period.get(), event.created()), who.get(),
				event);
	}

	/**
	 * The five things that can have happened, each said once — three of them at {@code info} because they are
	 * the product working, and two at {@code warn} because somebody has to look.
	 */
	private void report(Mirroring mirrored, SubscriberOnStripe who, StripeEvent event) {
		switch (mirrored) {
			case MIRRORED -> LOG.info("Subscription {} is mirrored as of {} ({}).", who.subscriptionId(),
					event.created(), event.type());
			case FELL_BACK_TO_THE_DEFAULT_TIER -> LOG.info("Stripe reports subscription {} as over, so its "
					+ "subscriber is back on the default tier and keeps their customer id (ADR-0018).",
					who.subscriptionId());
			// Not an error: one Stripe account can serve more than one deployment, and a subscription created
			// in the dashboard for somebody who never signed in here is nobody's mistake. Worth a line all the
			// same, because it is also what a mis-pointed `stripe listen` looks like.
			case NOBODY_HERE_IS_BILLED_AS_THAT -> LOG.warn("No subscription here is billed as customer {}, holds "
					+ "{}, or carries the tag that event named, so nothing was mirrored.", who.customerId(),
					who.subscriptionId());
			case NO_TIER_SELLS_THAT_PRICE -> LOG.warn("Somebody is paying for the Stripe Price on subscription "
					+ "{} and no tier in this catalog carries it, so they were granted nothing and left on the "
					+ "plan they were on. Tag that Price with `metadata.tier_code` and save it, which is what "
					+ "adopts it (ADR-0019).", who.subscriptionId());
			// Ordinary, and the reason the mirror keeps a timestamp at all: Stripe delivers at least once and
			// retries for three days, so an event that has been overtaken is a thing that happens rather than a
			// thing that went wrong.
			case SAID_BEFORE_WHAT_IS_ALREADY_MIRRORED -> LOG.debug("A {} event from {} about subscription {} is "
					+ "older than what is already mirrored there, so it was not applied.", event.type(),
					event.created(), who.subscriptionId());
		}
	}

	private final SubscriptionMirror mirror;

	private static final Logger LOG = LoggerFactory.getLogger(MirrorSubscriptions.class);

}
