package com.mprelist.billing.internal;

import java.util.List;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.SubscriptionSchedule;

/**
 * A <strong>Scheduled switch</strong> that has taken over lets go of its subscription (T90, ADR-0042).
 *
 * <p>{@link SwitchPlans#schedule} gives the chosen Price one phase and {@code end_behavior=release}, so left to
 * itself Stripe releases the schedule only when that phase ends, a whole period after the switch. Until then
 * the subscription is schedule-controlled, and Stripe refuses to set it to cancel at period end, which is how
 * the Customer Portal cancels (checked 2026-11-12). Nothing is pending by then, so nothing on our cards would
 * explain it.
 *
 * <p>So when a subscription event names a schedule that is in its last phase and would release anyway, it is
 * released now. Only those: a schedule still waiting for its switch is the switch itself, and one that ends by
 * cancelling (made in the dashboard) would have its cancellation undone.
 *
 * <p><strong>Never a reason to refuse the event.</strong> A Stripe that will not answer is a log line, and the
 * next event about the subscription tries again; the mirror is unaffected either way.
 */
@Service
class ReleaseFinishedSchedules {

	ReleaseFinishedSchedules(StripeAccount stripe) {
		this.stripe = stripe;
	}

	/** @param event a {@code customer.subscription.*} event, already mirrored */
	void after(StripeEvent event) {
		Optional<String> schedule = event.controllingSchedule();
		if (schedule.isEmpty()) {
			return;
		}
		Optional<StripeClient> client = this.stripe.client();
		if (client.isEmpty()) {
			return;
		}
		try {
			SubscriptionSchedule held = client.get().subscriptionSchedules().retrieve(schedule.get());
			if (!inItsLastPhaseAndReleasing(held)) {
				return;
			}
			client.get().subscriptionSchedules().release(schedule.get());
			LOG.info("Released schedule {}: its switch has taken over, so it no longer holds the subscription",
					schedule.get());
		}
		catch (StripeException unavailable) {
			LOG.warn("Could not release schedule {} after its switch took over; the next event tries again: {}",
					schedule.get(), unavailable.getMessage());
		}
	}

	private static boolean inItsLastPhaseAndReleasing(SubscriptionSchedule schedule) {
		if (!"active".equals(schedule.getStatus()) || !"release".equals(schedule.getEndBehavior())
				|| schedule.getCurrentPhase() == null) {
			return false;
		}
		long currentEnd = schedule.getCurrentPhase().getEndDate();
		List<SubscriptionSchedule.Phase> phases = schedule.getPhases();
		return phases != null && phases.stream().noneMatch(phase -> phase.getStartDate() >= currentEnd);
	}

	private final StripeAccount stripe;

	private static final Logger LOG = LoggerFactory.getLogger(ReleaseFinishedSchedules.class);

}
