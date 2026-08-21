package com.mprelist.billing.internal;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.stripe.exception.SignatureVerificationException;
import com.stripe.net.Webhook;

/**
 * Whether an event really came from Stripe — the whole of the authentication on the one route in this
 * application that no bearer token reaches (#82, T51).
 *
 * <p>Stripe signs the exact bytes it sent with a secret only the two ends hold, and stamps the signature with
 * a timestamp so a captured request cannot be replayed for ever. Verifying that is HMAC-SHA256, a
 * constant-time compare and a tolerance window, and all three are here by way of Stripe's own library rather
 * than written out again — the failure mode of getting the compare wrong is a timing oracle nobody would
 * notice, and the failure mode of skipping the timestamp is a replay.
 *
 * <p><strong>Fail-closed, including when it is not configured at all.</strong> With no secret every event is
 * refused, which is the one safe reading of "we cannot tell whether this is Stripe": the alternative — an
 * unconfigured deployment accepting anything that posts JSON — would let a stranger publish tiers into the
 * catalog every subscriber is priced by. That it is unset is said once at startup rather than only when an
 * event is refused, because the symptom otherwise shows up in Stripe's dashboard as a failing endpoint and
 * nowhere in our own log.
 */
@Component
class SignedByStripe {

	SignedByStripe(@Value("${mprelist.stripe.webhook-secret:}") String secret) {
		this.secret = secret == null ? "" : secret.strip();
		if (this.secret.isEmpty()) {
			LOG.warn("No Stripe webhook secret is configured, so every Stripe event will be refused. "
					+ "Set MPRELIST_STRIPE_WEBHOOK_SECRET — `stripe listen` prints one for a local run, and "
					+ "the Stripe dashboard holds the deployed endpoint's.");
		}
		else {
			LOG.info("Stripe events are verified against a configured webhook secret.");
		}
	}

	/**
	 * @param payload the request body exactly as it arrived. Any re-serialisation of it — pretty-printing,
	 * re-ordering keys, parsing and writing it back — changes the bytes the signature was computed over and so
	 * turns every genuine event into a refused one, which is why the route reads a {@code String} and hands it
	 * here before anything else looks at it
	 * @param header the {@code Stripe-Signature} header, or {@code null} where the caller sent none. Absent is
	 * not an error worth its own answer: a caller who did not sign is a caller we cannot identify, which is
	 * the same refusal as one who signed wrongly
	 * @return whether this really is Stripe
	 */
	boolean signed(String payload, String header) {
		if (this.secret.isEmpty() || header == null || header.isBlank()) {
			return false;
		}
		try {
			// The library's own default tolerance, five minutes, rather than a number of ours: it is the
			// window Stripe's documentation describes and the one its retries are shaped around, and a
			// tighter one would refuse genuine events from a host whose clock has drifted a little.
			Webhook.Signature.verifyHeader(payload, header, this.secret, Webhook.DEFAULT_TOLERANCE);
			return true;
		}
		catch (SignatureVerificationException wrong) {
			// The message, not the payload: it names which way the header was wrong — no signature for the
			// scheme, no timestamp, outside the tolerance — and the body of a refused event is the one thing
			// on this route we have no reason to trust and every reason not to write down.
			LOG.warn("Refused an event that does not carry Stripe's signature: {}", wrong.getMessage());
			return false;
		}
	}

	private final String secret;

	private static final Logger LOG = LoggerFactory.getLogger(SignedByStripe.class);

}
