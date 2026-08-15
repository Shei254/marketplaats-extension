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
 * <p>Two of the contract's four are here. {@code UNAUTHENTICATED} is {@code identity}'s — it is answered by the
 * filter chain before any route is reached, which is what makes it true of routes no ticket has written yet
 * (#19) — and {@code RATE_LIMITED} arrives with #25's SafetyPolicy, whose check the gate leaves a place for.
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
	 * The relists this period are spent. Carries {@code resetAt} — the end of the window — because "you have
	 * used your 3" is only actionable beside "and they come back on the 14th", and it is a free user's ordinary
	 * denial rather than an error.
	 *
	 * <p>{@code 429} rather than {@code 403}: the request is one the caller may make again, just not yet.
	 */
	QUOTA_EXCEEDED(HttpStatus.TOO_MANY_REQUESTS);

	HttpStatus status() {
		return this.status;
	}

	ReasonCode(HttpStatus status) {
		this.status = status;
	}

	private final HttpStatus status;

}
