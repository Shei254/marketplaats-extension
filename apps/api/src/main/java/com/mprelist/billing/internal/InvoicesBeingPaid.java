package com.mprelist.billing.internal;

import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.Invoice;
import com.stripe.model.InvoicePayment;
import com.stripe.param.InvoiceRetrieveParams;

/**
 * Whether the invoice behind a {@code past_due} subscription is being paid after all (ADR-0036, amended
 * 2026-11-12).
 *
 * <p><strong>Why it is asked.</strong> A switch on a bank debit is made with {@code allow_incomplete}, and Stripe
 * answers {@code past_due} until the debit clears: about twenty seconds in test mode, days in live mode
 * ("within 14 days", says Stripe's own page). Read as Dunning, that is a subscriber refused every relist and
 * told to pay an invoice they already paid. The status cannot tell the two apart; the PaymentIntent paying the
 * invoice can. {@code processing} is a debit on its way, and {@code succeeded} is a {@code past_due} that was
 * overtaken before it was read. Anything else — waiting on the payer, failed, no payment at all — is Dunning,
 * which is what revokes access when a debit bounces.
 *
 * <p><strong>Two Stripe calls, not one.</strong> The PaymentIntent is five levels below a subscription and four
 * below an invoice's payments list once {@code data} is counted, and Stripe expands at most four, so it is
 * fetched on its own.
 *
 * <p><strong>A Stripe that cannot be asked is Dunning.</strong> Stripe's own word stands where it cannot be
 * checked, and the {@code active} that follows a cleared debit puts it right.
 */
@Component
class InvoicesBeingPaid {

	InvoicesBeingPaid(StripeAccount stripe) {
		this.stripe = stripe;
	}

	/**
	 * For the webhook, which has only the invoice's id.
	 *
	 * @param invoiceId the subscription's {@code latest_invoice}
	 */
	boolean beingPaid(String invoiceId) {
		StripeClient client = this.stripe.client().orElse(null);
		if (client == null || invoiceId == null) {
			return false;
		}
		try {
			Invoice invoice = client.invoices().retrieve(invoiceId,
					InvoiceRetrieveParams.builder().addExpand("payments").build(), null);
			return beingPaid(client, invoice);
		}
		catch (StripeException unavailable) {
			LOG.warn("Could not ask Stripe whether invoice {} is being paid, so its subscription is taken to be "
					+ "past due as reported: {}", invoiceId, unavailable.getMessage());
			return false;
		}
	}

	/**
	 * For a caller that already holds the invoice with its {@code payments} expanded.
	 *
	 * @param invoice the invoice, or {@code null} for none
	 */
	static boolean beingPaid(StripeClient client, Invoice invoice) throws StripeException {
		if (invoice == null || invoice.getPayments() == null || invoice.getPayments().getData() == null) {
			return false;
		}
		for (InvoicePayment payment : invoice.getPayments().getData()) {
			String intent = payment.getPayment() == null ? null : payment.getPayment().getPaymentIntent();
			if (intent != null && ON_ITS_WAY.contains(client.paymentIntents().retrieve(intent).getStatus())) {
				return true;
			}
		}
		return false;
	}

	private final StripeAccount stripe;

	private static final Set<String> ON_ITS_WAY = Set.of("processing", "succeeded");

	private static final Logger LOG = LoggerFactory.getLogger(InvoicesBeingPaid.class);

}
