package com.mprelist.enforcement.internal;

import java.time.OffsetDateTime;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * What the gate answers: an authorization, or a refusal carrying the reason the extension renders. Sealed, so
 * that the route below cannot forget a case and a third answer — #25's {@code RATE_LIMITED} is not one, since a
 * refusal is a refusal — would have to be added here rather than appear as a status somewhere.
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
	 * @param reason the code, which is the whole of what a client acts on
	 * @param resetAt when the quota comes back, for {@link ReasonCode#QUOTA_EXCEEDED} and null otherwise
	 */
	@JsonInclude(JsonInclude.Include.NON_NULL)
	record Refused(ReasonCode reason, OffsetDateTime resetAt) implements Verdict {

		static Refused because(ReasonCode reason) {
			return new Refused(reason, null);
		}

	}

}
