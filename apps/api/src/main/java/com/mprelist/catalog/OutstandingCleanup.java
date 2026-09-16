package com.mprelist.catalog;

import java.util.UUID;

/**
 * One Stripe call a deleted tier is still waiting on (T77, ADR-0032) — a row of the queue, as the module that
 * drains it reads one.
 *
 * @param id this row, which is how the drain says it is done with it or why it is not. The queue is keyed on
 * the row rather than on the Stripe object, so a call that has been retried nine times and one enqueued a
 * moment ago are told apart by nothing the caller has to reconstruct
 * @param tierCode the tier that was deleted. Carried so that a log line about a stuck row names the plan an
 * operator remembers deleting, rather than a bare {@code sub_…} they would have to look up
 * @param kind which call is outstanding, and so which Stripe service the drain reaches for
 * @param stripeId the object it is about, exactly as Stripe spells it
 * @param attempts how many times this has already been tried and refused — zero on a row nothing has touched.
 * It is what makes "Stripe will never accept this" visible as a number rather than as a queue that is simply
 * never empty
 */
public record OutstandingCleanup(UUID id, String tierCode, StripeCleanup kind, String stripeId, int attempts) {

	public OutstandingCleanup {
		if (id == null || kind == null) {
			throw new IllegalArgumentException("An outstanding call is one row and one kind of call");
		}
		if (tierCode == null || tierCode.isBlank()) {
			throw new IllegalArgumentException("Every cleanup row names the tier it was left behind by");
		}
		if (stripeId == null || stripeId.isBlank()) {
			throw new IllegalArgumentException("A call about no Stripe object is not one to make");
		}
		if (attempts < 0) {
			throw new IllegalArgumentException("A call cannot have been tried fewer than no times: " + attempts);
		}
	}

}
