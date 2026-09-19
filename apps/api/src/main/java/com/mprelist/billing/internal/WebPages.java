package com.mprelist.billing.internal;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The pages of {@code apps/web} a browser is sent back to when it is done at Stripe (T19, #29 · T21, #31).
 *
 * <p><strong>One home for three paths and for the base URL they hang off.</strong> Stripe holds the only other
 * copy of them: they travel in a Checkout session and in a Portal session rather than in anything a client
 * fetches, so a rename in {@code apps/web/src/routes.ts} that did not happen here would be found by somebody
 * who has just paid. Spelling them twice on the Java side as well would make that two places to miss.
 *
 * <p>The trailing slash is trimmed once, here, for the same reason: {@code https://example.test//success} is a
 * URL Stripe accepts and a page most hosts do not serve, at the moment somebody has just been charged. A guard
 * that lived at each call site would be a guard the next call site forgets.
 *
 * <p>These pages carry no authentication at all (ADR-0017). The browser Stripe redirects is not one this
 * application knows anything about, and the page it lands on deliberately learns nothing either.
 */
@Component
class WebPages {

	WebPages(@Value("${mprelist.web.base-url}") String baseUrl) {
		this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
	}

	/** Where Checkout sends somebody whose payment went through. The webhook is what actually moves the plan. */
	String paymentLanded() {
		return this.baseUrl + "/success";
	}

	/** And where it sends somebody who closed it without paying. */
	String paymentAbandoned() {
		return this.baseUrl + "/cancel";
	}

	/**
	 * Where the Customer Portal's own "return" link goes. A page of its own rather than the success page,
	 * which would congratulate somebody who has just cancelled.
	 */
	String billingManaged() {
		return this.baseUrl + "/billing";
	}

	private final String baseUrl;

}
