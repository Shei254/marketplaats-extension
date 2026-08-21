package com.mprelist.billing.internal;

/**
 * What came of asking to buy something (T19, #29).
 *
 * <p>Three answers and no exceptions, because the caller's job is to turn each into a different status and
 * the difference matters to whoever is reading the screen: one is a plan that is not for sale, one is Stripe
 * being unreachable, and one is a URL to send a browser to. A single {@code Optional} would collapse the
 * first two, and they are not the same thing — retrying fixes exactly one of them.
 */
sealed interface Checkout {

	/** The session exists; send the browser here. */
	record Opened(String url) implements Checkout {
	}

	/**
	 * No such plan is on sale — unknown code, unpublished, or a draft the sync created at quota 0 before
	 * anybody said what it grants (ADR-0019). A stale client asking for a plan that has since been withdrawn
	 * looks exactly like this, which is why it is not an error: the cards it is holding are simply out of date.
	 */
	record NotForSale() implements Checkout {
	}

	/** Stripe could not be asked, or would not answer. The one of the three that a retry can fix. */
	record Unavailable() implements Checkout {
	}

}
