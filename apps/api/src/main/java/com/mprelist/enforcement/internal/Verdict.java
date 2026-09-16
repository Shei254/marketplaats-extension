package com.mprelist.enforcement.internal;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.mprelist.enforcement.ReasonCode;

/**
 * What the gate answers: an authorization, or a refusal carrying the reason the extension renders. Sealed, so
 * that the route below cannot forget a case and a third answer would have to be added here rather than appear
 * as a status somewhere. {@code RATE_LIMITED} did not turn out to be one, which is the sealing working: a
 * refusal is a refusal, and what a new code brings is a field of its own rather than a shape of its own.
 *
 * <p>These records are also the wire shapes {@code docs/enforcement-contract.md} names, serialized as they
 * stand. One type rather than a domain answer plus a response mapped from it, because the two would be the
 * same three fields and the mapping between them is where a field silently stops being sent.
 */
sealed interface Verdict {

	/**
	 * The short-lived, single-use OK the extension has to hold before it deletes anything (ADR-0007).
	 *
	 * @param authToken a JWT this backend signed, carrying {@code sub}, {@code adId}, {@code jti} and
	 * {@code exp} — the unforgeable half of the verdict, which a modified extension cannot mint for itself
	 * @param expiresAt when it stops being one, about 45 seconds out. Sent beside the token so a client does
	 * not have to decode a JWT to know whether the grant it is holding is still good
	 * @param jti the reservation this authorization spent, and so the handle {@code /complete} settles or
	 * refunds it by (#23)
	 */
	record RelistAuthorization(String authToken, OffsetDateTime expiresAt, UUID jti) implements Verdict {
	}

	/**
	 * A denial, in the shape every denial in the contract has: a typed code, plus whatever that code adds.
	 *
	 * <p>{@code NON_NULL} so that a code which adds nothing sends nothing — a {@code 402} carrying
	 * {@code "resetAt": null} would invite a client to read a reset date out of a refusal that has none, and
	 * the contract describes the field as belonging to the code rather than to the shape.
	 *
	 * <p><strong>Each code is built by the factory that knows what it carries</strong>, rather than by callers
	 * filling in the nulls around the one field they mean. Two of the three components are a code's own
	 * baggage, so a refusal assembled at the point of refusal is one that can carry the wrong code's — a
	 * {@code 402} with a reset date, or a cooldown with none of the two things that would make it actionable.
	 *
	 * @param reason the code, which is the whole of what a client acts on
	 * @param resetAt when the quota comes back, for {@link ReasonCode#QUOTA_EXCEEDED} and null otherwise
	 * @param retryAfter seconds until this caller may relist again, for {@link ReasonCode#RATE_LIMITED} and
	 * null otherwise. Whole seconds rather than an instant, and named after HTTP's own {@code Retry-After},
	 * which is what a client renders as a countdown — a date would make every client subtract two clocks that
	 * do not agree, which is the arithmetic a cooldown of a few seconds cannot survive. It travels in the body
	 * and <em>not</em> in the header of that name: the contract puts everything a client acts on in the JSON,
	 * and a second copy in a header is a second thing that can disagree with the first
	 */
	@JsonInclude(JsonInclude.Include.NON_NULL)
	record Refused(ReasonCode reason, OffsetDateTime resetAt, Long retryAfter) implements Verdict {

		/**
		 * A code that adds nothing — {@link ReasonCode#SUBSCRIPTION_INACTIVE}, since #147
		 * {@link ReasonCode#BULK_NOT_ENTITLED}, and since T77 {@link ReasonCode#NO_TIER}: what to do about any
		 * of them is a screen, and a screen needs no field to find. The second was declared here before
		 * anything sent it and is now sent by the gate, which is the sealing working — a new code brought a
		 * field of its own rather than a shape of its own, and neither of the two since has brought either.
		 *
		 * <p>{@code NO_TIER} carries nothing for a stronger reason than the other two, and it is worth saying:
		 * theirs is that the field would be redundant, and this one's is that there is no screen either. What
		 * fixes it is an operator making a tier the default (ADR-0032).
		 */
		static Refused because(ReasonCode reason) {
			return new Refused(reason, null, null);
		}

		/** Out of quota until the window rolls, which is the one date this denial is actionable beside. */
		static Refused untilTheQuotaComesBackAt(OffsetDateTime resetAt) {
			return new Refused(ReasonCode.QUOTA_EXCEEDED, resetAt, null);
		}

		/**
		 * Going too fast, and how long to wait — already whole seconds and already rounded up when it gets
		 * here ({@link RelistPace#waitAfter}), so nothing is lost by asking a {@link Duration} for them.
		 */
		static Refused untilTheyMayRelistAgainIn(Duration wait) {
			return new Refused(ReasonCode.RATE_LIMITED, null, wait.toSeconds());
		}

	}

}
