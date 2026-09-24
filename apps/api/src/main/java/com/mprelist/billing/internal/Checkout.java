package com.mprelist.billing.internal;

/**
 * What came of asking to buy something (T19, #29).
 *
 * <p>Four answers and no exceptions, because the caller's job is to turn each into a different status and
 * the difference matters to whoever is reading the screen: one is a plan that is not for sale, one is Stripe
 * being unreachable, one is somebody who already pays (T83), and one is a URL to send a browser to. A single
 * {@code Optional} would collapse the first two, and they are not the same thing — retrying fixes exactly one
 * of them.
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

	/** Stripe could not be asked, or would not answer. The one of these that a retry can fix. */
	record Unavailable() implements Checkout {
	}

	/**
	 * Stripe is already billing this account (T83), so a session would be a second subscription on the same
	 * customer and a second charge. What they want is a plan switch, and that is the Customer Portal's — it
	 * prorates one, and {@code customer.subscription.updated} moves the tier. The only one of these that is a
	 * statement about the caller, which is why it alone carries a {@code reason}.
	 */
	record AlreadyPaying() implements Checkout {
	}

}
