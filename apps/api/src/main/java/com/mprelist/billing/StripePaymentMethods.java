package com.mprelist.billing;

import java.util.List;

/**
 * Which ways of paying a buyer will be offered when Checkout opens (T65, #137).
 *
 * <p>This module is the only one that talks to Stripe (ADR-0014), so {@code display} asks here and is handed
 * a list of Stripe's own tokens — {@code ideal}, {@code paypal}, {@code card}, {@code sepa_debit} — rather
 * than a Stripe object or a sentence. The same division {@link StripePrices} keeps: raw vocabulary crosses
 * the boundary and whoever renders it decides what it is called, exactly as {@code currency} and
 * {@code interval} already do.
 *
 * <p><strong>Why this exists when {@code OpenCheckout} deliberately names no payment method.</strong> That
 * comment is about <em>choosing</em> them — naming a method in code would mean a deploy to add one, and would
 * put a second answer beside the dashboard's. This only <em>reports</em> what the dashboard already says, so
 * there is still exactly one place the answer lives; the popup is reading it rather than holding a copy. A
 * hardcoded sentence in the popup would have been the second answer that comment warns about (ADR-0022).
 *
 * <p><strong>Empty means "no sentence", and it is deliberately two things at once</strong> — Stripe could not
 * be asked, or its configuration turns everything off. Both render nothing, so the caller has no branch to
 * write; the difference is in the log, where the operator is, rather than in a contract nobody could act on
 * differently. It is emphatically <em>not</em> a reason to withhold the plan cards: a price that cannot be
 * fetched takes the whole screen with it because the screen is a comparison, and this is not part of one.
 */
public interface StripePaymentMethods {

	/**
	 * @return the methods Checkout will offer, in Stripe's spelling, or an empty list when Stripe could not
	 * be asked or has nothing turned on
	 */
	List<String> offered();

}
