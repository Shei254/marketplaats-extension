package com.mprelist.enforcement.internal;

import org.springframework.http.HttpStatus;

/**
 * The typed reason codes {@code docs/enforcement-contract.md} denies with, and the status each is served as.
 * The extension's gate (#34) reads the code and never the prose, which is what lets a denial change its
 * wording without changing what a client does about it.
 *
 * <p>The mapping lives on the code rather than at the point of refusal, so that "quota exhausted is a 429" is
 * stated once. Nothing else in this application decides a denial's status.
 *
 * <p>Four of the contract's five are here. {@code UNAUTHENTICATED} is {@code identity}'s — it is answered by
 * the filter chain before any route is reached, which is what makes it true of routes no ticket has written
 * yet (#19).
 *
 * <p><strong>{@link #BULK_NOT_ENTITLED} is declared and not yet answered with.</strong> The contract denies
 * with it (ADR-0025) and {@code packages/contracts} restates it, so it is here to keep the three lists one
 * list — {@code enforcement.test.ts} reads this file as text and holds them to each other. Nothing constructs
 * it until {@code /authorize} accepts a {@code batch} flag to refuse (#147). A code the backend can send and a
 * client has never heard of is a denial rendered as "something went wrong, try again" at somebody who could
 * have fixed it in a click, which is the failure that ordering prevents.
 */
enum ReasonCode {

	/**
	 * A payer whose subscription lapsed, and only ever that. Every user always has a subscription and a free
	 * one is {@code active} (ADR-0014), so a user who has never paid is denied by {@link #QUOTA_EXCEEDED} —
	 * this code means the plan stopped, which is why the extension renders it as an upsell rather than an
	 * upgrade prompt.
	 *
	 * <p>{@code 402}, which is the contract's choice: it is the status the extension's gate switches on to show
	 * "your payment lapsed" without reading the body twice.
	 */
	SUBSCRIPTION_INACTIVE(HttpStatus.PAYMENT_REQUIRED),

	/**
	 * A caller asked for a capability their plan does not include — today, a {@code batch} on
	 * {@code /authorize} from an Entitlement carrying no {@code bulk} flag (ADR-0025, #147).
	 *
	 * <p><strong>Checked above {@link #QUOTA_EXCEEDED} and below the subscription status</strong>, which is the
	 * whole reason it is a code rather than a reuse of one. Both send the user to the same plan screen and only
	 * one of them describes what was asked for: answering "you are out of relists" to somebody who asked for a
	 * feature they do not have describes a second thing they also do not have, and neither sentence is the one
	 * they need.
	 *
	 * <p>{@code 403} rather than a {@code 429}: the caller is authenticated and simply not permitted, and no
	 * amount of waiting changes it. It is told apart from the {@code 403} the resource server already answers an
	 * ADMIN-less caller with by the rule the contract's denial shape states — <em>the presence of
	 * {@code reason} means the gate turned you away</em>. That one carries no body, and this one does.
	 *
	 * <p><strong>How many at once is not this code's business.</strong> {@code features.bulk} carries
	 * {@code {"upTo": N}} and nothing here can count a selection, because a batch arrives one ad at a time. The
	 * API says <em>whether</em>, and the popup says <em>how many</em>.
	 */
	BULK_NOT_ENTITLED(HttpStatus.FORBIDDEN),

	/**
	 * The relists this period are spent. Carries {@code resetAt} — the end of the window — because "you have
	 * used your 3" is only actionable beside "and they come back on the 14th", and it is a free user's ordinary
	 * denial rather than an error.
	 *
	 * <p>{@code 429} rather than {@code 403}: the request is one the caller may make again, just not yet.
	 */
	QUOTA_EXCEEDED(HttpStatus.TOO_MANY_REQUESTS),

	/**
	 * Too fast (#25, ADR-0008). Carries {@code retryAfter} — how many seconds until the caller may relist
	 * again — because a cooldown a user cannot see the end of is indistinguishable from something broken, and
	 * the extension renders it as a timer rather than as an error.
	 *
	 * <p>{@code 429} beside {@link #QUOTA_EXCEEDED}, and the two are told apart by the code rather than by the
	 * status: they are the same statement about HTTP — come back later — and different statements about the
	 * user, one of whom needs a bigger plan and the other of whom needs a minute. Which is exactly why the
	 * contract's denials carry a typed code at all.
	 */
	RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS);

	HttpStatus status() {
		return this.status;
	}

	ReasonCode(HttpStatus status) {
		this.status = status;
	}

	private final HttpStatus status;

}
