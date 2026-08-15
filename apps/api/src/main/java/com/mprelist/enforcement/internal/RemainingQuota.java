package com.mprelist.enforcement.internal;

import java.time.OffsetDateTime;

import com.mprelist.catalog.Entitlement;
import com.mprelist.subscription.QuotaPeriod;

/**
 * How many relists this period has left, and when it comes back — the body of a {@code 200} from
 * {@code /complete}, and the same arithmetic the gate refuses on.
 *
 * <p><strong>One calculation, two readers, and that is the point of the type.</strong> The gate refuses when
 * the units held reach what the tier grants; {@code /complete} answers with what is left of the same two
 * numbers, and #26's {@code /api/me} will render it. Two subtractions written a day apart are two chances for
 * the popup to show "1 relist left" beside a button the gate refuses — the disagreement nobody would notice
 * until a user reported it. {@link #isSpent()} is that agreement made structural: it is true exactly when the
 * subtraction has nothing left in it.
 *
 * <p>The record is also the wire shape, serialized as it stands, which is why the component is called
 * {@code quotaRemaining} rather than something shorter: {@code docs/enforcement-contract.md} names the field
 * and a mapping to it would be one more place a field could stop being sent.
 *
 * @param quotaRemaining relists left in this period, <strong>never below zero</strong>. A tier's quota is an
 * operator's to edit at any time (ADR-0014), so a subscriber who has spent five can find themselves on a rung
 * granting three — and a negative number rendered in the popup is not a smaller quota, it is a bug on screen.
 * Clamped here rather than at each reader, which is also what keeps {@link #isSpent()} the same question as
 * the gate's comparison
 * @param resetAt the end of the window, exclusive, which is {@link QuotaPeriod}'s own {@code end} and the
 * date every quota denial carries
 */
record RemainingQuota(int quotaRemaining, OffsetDateTime resetAt) {

	/**
	 * What is left of a tier's grant after the units a period is already holding.
	 *
	 * @param granted what the caller's tier allows per period (#21)
	 * @param held the reservations in this window that have not been refunded (#22) — an in-flight relist
	 * among them, since the unit is taken before the extension does anything with it
	 * @param period the window, whose {@code end} is the {@code resetAt} answered with
	 */
	static RemainingQuota of(Entitlement granted, int held, QuotaPeriod period) {
		return new RemainingQuota(Math.max(0, granted.relistsPerPeriod() - held), period.end());
	}

	/**
	 * Whether there is nothing left to spend — the gate's refusal, asked of this rather than recomputed from
	 * the two numbers it came from.
	 */
	boolean isSpent() {
		return this.quotaRemaining == 0;
	}

}
