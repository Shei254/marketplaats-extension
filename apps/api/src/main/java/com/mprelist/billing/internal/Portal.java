package com.mprelist.billing.internal;

/**
 * What came of asking to manage a subscription (T21, #31).
 *
 * <p>Three answers and no exceptions, for {@link Checkout}'s reason: each becomes a different status and the
 * difference is what the popup shows. One is a URL to send a browser to, one is an account Stripe has never
 * heard of, and one is Stripe being unreachable — and only the last is worth a retry.
 */
sealed interface Portal {

	/** The session exists; send the browser here. It expires, so it is opened rather than stored. */
	record Opened(String url) implements Portal {
	}

	/**
	 * Nobody has ever been billed for this account, so Stripe holds no customer to open a Portal for.
	 *
	 * <p>Which is every free user who has never bought anything — the ordinary state of most accounts, and not
	 * a fault on either side. It is <em>not</em> what a cancelled subscriber gets: ADR-0018 keeps
	 * {@code stripe_customer_id} on the row precisely so that somebody who paid once can still reach their
	 * invoices and their card afterwards.
	 */
	record NothingToManage() implements Portal {
	}

	/** Stripe could not be asked, or would not answer. The one of the three that a retry can fix. */
	record Unavailable() implements Portal {
	}

}
