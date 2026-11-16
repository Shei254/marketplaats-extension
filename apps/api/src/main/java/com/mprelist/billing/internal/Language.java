package com.mprelist.billing.internal;

import java.util.Arrays;
import java.util.Optional;

/**
 * The <strong>Language</strong> a reader is reading in, as the two requests that open a Stripe page carry it
 * (T96, ADR-0043): {@code nl} or {@code en}, the same two codes as {@code @mprelist/contracts}' {@code Language}.
 *
 * <p><strong>This is the only place the API learns that a language exists</strong>, and all it does with one is
 * hand it to Stripe as the page's {@code locale}. Nothing is stored: the Language belongs to the device, and the
 * next request carries it again.
 */
enum Language {

	NL("nl", com.stripe.param.checkout.SessionCreateParams.Locale.NL,
			com.stripe.param.billingportal.SessionCreateParams.Locale.NL),

	EN("en", com.stripe.param.checkout.SessionCreateParams.Locale.EN,
			com.stripe.param.billingportal.SessionCreateParams.Locale.EN);

	Language(String code, com.stripe.param.checkout.SessionCreateParams.Locale checkout,
			com.stripe.param.billingportal.SessionCreateParams.Locale portal) {
		this.code = code;
		this.checkout = checkout;
		this.portal = portal;
	}

	/**
	 * The Language a code names, or empty for one that names neither of ours. A request that sent no code at all
	 * is the caller's to tell apart: that one means what it meant before there was a Language, and an unknown
	 * code is a request this API could not read.
	 */
	static Optional<Language> named(String code) {
		return Arrays.stream(values()).filter(language -> language.code.equals(code)).findFirst();
	}

	com.stripe.param.checkout.SessionCreateParams.Locale checkoutLocale() {
		return this.checkout;
	}

	com.stripe.param.billingportal.SessionCreateParams.Locale portalLocale() {
		return this.portal;
	}

	private final String code;

	private final com.stripe.param.checkout.SessionCreateParams.Locale checkout;

	private final com.stripe.param.billingportal.SessionCreateParams.Locale portal;

}
