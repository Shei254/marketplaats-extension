package com.mprelist.billing.internal;

/**
 * What came of asking to switch plan, or what a switch would cost (T85, ADR-0036).
 *
 * <p>A <strong>Plan switch</strong> is the Price on the Stripe subscription somebody already has, changed in
 * place — never a second Checkout, which T83's {@code 409} refuses. Sealed for {@link Checkout}'s reason: each
 * answer is a different status, and the two refusals a retry cannot fix are not the one it can.
 */
sealed interface PlanSwitch {

	/**
	 * What the switch would invoice now, from Stripe's own preview, and never an amount we worked out. Since
	 * T90 (ADR-0042) that is the new plan's full price, since nothing is credited; a credit already on the
	 * Stripe customer can still make it smaller, or zero.
	 *
	 * @param amount in the currency's smallest unit, as Stripe counts it
	 * @param currency ISO 4217, lower case
	 * @param renewsAt the end of the period they have paid for, which is when a Scheduled switch would take
	 * over — Stripe's, not the monthly reset {@code /api/me} answers with, which differs for an annual payer
	 */
	record Previewed(long amount, String currency, java.time.OffsetDateTime renewsAt) implements PlanSwitch {
	}

	/** Done, or nothing to do: the subscription is billed at that Price now, and the webhook moves the tier. */
	record Switched() implements PlanSwitch {
	}

	/**
	 * Stripe could not take the money without the payer — 3-D Secure, most often. Nothing has changed yet
	 * ({@code pending_if_incomplete}); paying on this page is what applies the switch.
	 *
	 * @param url the invoice's hosted page
	 */
	record ConfirmPayment(String url) implements PlanSwitch {
	}

	/**
	 * A <strong>Scheduled switch</strong> is pending (T90, ADR-0042): the Price they pay now until Stripe's
	 * period ends, then the chosen one. The webhook mirrors it; this is only what the route answers.
	 *
	 * @param at when the chosen Price takes over, which is Stripe's current period end
	 */
	record Scheduled(java.time.OffsetDateTime at) implements PlanSwitch {
	}

	/**
	 * Stripe is collecting an invoice that has not been paid — Dunning: {@code past_due}, {@code unpaid} or
	 * {@code incomplete} (T90, ADR-0042). Nothing is switched, now or at renewal, until it is.
	 */
	record InvoiceOpen() implements PlanSwitch {
	}

	/** Stripe is billing this caller for nothing, so there is nothing to switch: Checkout is theirs. */
	record NotPaying() implements PlanSwitch {
	}

	/** No published tier is sold under that code at that rhythm — {@link Checkout.NotForSale}'s answer. */
	record NotForSale() implements PlanSwitch {
	}

	/** Stripe could not be asked, or would not answer. The one of these a retry can fix. */
	record Unavailable() implements PlanSwitch {
	}

}
