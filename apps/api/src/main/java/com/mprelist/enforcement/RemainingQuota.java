package com.mprelist.enforcement;

import java.time.OffsetDateTime;

import com.fasterxml.jackson.annotation.JsonIgnore;

import com.mprelist.catalog.Entitlement;
import com.mprelist.subscription.QuotaPeriod;

/**
 * How many relists this period has left, and when it comes back — the body of a {@code 200} from
 * {@code /complete}, half the body of one from {@code /api/me}, and the same arithmetic the gate refuses on.
 *
 * <p><strong>One calculation, three readers, and that is the point of the type.</strong> The gate refuses
 * when the units held reach what the tier grants; {@code /complete} answers with what is left of the same two
 * numbers, and {@code /api/me} renders it (#26). Two subtractions written a day apart are two chances for the
 * popup to show "1 relist left" beside a button the gate refuses — the disagreement nobody would notice until
 * a user reported it. {@link #isSpent()} is that agreement made structural: it is true exactly when the
 * subtraction has nothing left in it.
 *
 * <p><strong>Public as of #26, which is the first module outside {@code enforcement} to ask this one
 * anything</strong> (ADR-0012). It is a number and a date about a period, so it carries nothing an outside
 * reader could mistake for a grant: the reservations it was counted from, the tier it was counted against and
 * the SQL that reached either stay {@code internal}. {@link #of} is public for the same boundary reason —
 * this module's own implementation lives in a sub-package, so the factory it builds one with has to be
 * reachable from there.
 *
 * <p>The record is also the wire shape, serialized as it stands where {@code /complete} answers with it,
 * which is why the component is called {@code quotaRemaining} rather than something shorter:
 * {@code docs/enforcement-contract.md} names the field and a mapping to it would be one more place a field
 * could stop being sent. {@code /api/me} spells the same two out flat beside its other three rather than
 * nesting this record under a key, because that body's shape is the contract's too.
 *
 * @param quotaRemaining relists left in this period, <strong>never below zero</strong>. A tier's quota is an
 * operator's to edit at any time (ADR-0014), so a subscriber who has spent five can find themselves on a rung
 * granting three — and a negative number rendered in the popup is not a smaller quota, it is a bug on screen.
 * Clamped here rather than at each reader, which is also what keeps {@link #isSpent()} the same question as
 * the gate's comparison. <strong>{@code null} on an unlimited tier</strong> (ADR-0029), which is a different
 * fact from any number and is why the component is boxed: there is nothing left of a grant that has no
 * ceiling, and a large number in its place would be a lie the popup would draw a bar against
 * @param resetAt the end of the window, exclusive, which is {@link QuotaPeriod}'s own {@code end} and the
 * date every quota denial carries
 */
public record RemainingQuota(Integer quotaRemaining, OffsetDateTime resetAt) {

	/**
	 * What is left of a tier's grant after the units a period is already holding.
	 *
	 * <p><strong>An unlimited tier has nothing to subtract from</strong> (ADR-0029), so the answer is
	 * {@code null} and {@code held} is not looked at. Its caller may skip counting it altogether, since
	 * nothing reads the number.
	 *
	 * @param granted what the caller's tier allows per period (#21), or {@code null} for unlimited
	 * @param held the reservations in this window that have not been refunded (#22) — an in-flight relist
	 * among them, since the unit is taken before the extension does anything with it
	 * @param period the window, whose {@code end} is the {@code resetAt} answered with
	 */
	public static RemainingQuota of(Entitlement granted, int held, QuotaPeriod period) {
		Integer allowed = granted.relistsPerPeriod();
		return new RemainingQuota(allowed == null ? null : Math.max(0, allowed - held), period.end());
	}

	/**
	 * Whether there is nothing left to spend — the gate's refusal, asked of this rather than recomputed from
	 * the two numbers it came from.
	 *
	 * <p><strong>{@code @JsonIgnore} because this record is also a wire shape.</strong> The method was
	 * package-private until #26 published the type, and public plus an {@code is} prefix is a property as far
	 * as Jackson is concerned — so {@code /complete} began answering with a third field, {@code "spent"},
	 * that no contract names and a client could come to read instead of the number beside it.
	 * {@code RelistCompletionTest} asserts the body has two fields and is what caught it.
	 */
	@JsonIgnore
	public boolean isSpent() {
		// An unlimited tier is never spent, which is the whole of what "unlimited" changes about the gate
		// (ADR-0029): the order of the checks, the reservation and the pacing rails are untouched.
		return this.quotaRemaining != null && this.quotaRemaining == 0;
	}

}
