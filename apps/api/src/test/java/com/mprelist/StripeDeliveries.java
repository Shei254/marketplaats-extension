package com.mprelist;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.GeneralSecurityException;
import java.time.Instant;
import java.util.HexFormat;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * A Stripe event delivered to {@code POST /api/stripe/webhook} the way Stripe delivers one: the exact bytes,
 * under a {@code Stripe-Signature} header computed from them.
 *
 * <p>One home for it, because two suites now deliver events — {@link StripePriceSyncTest} for the Price half
 * of ADR-0019 and {@link StripeSubscriptionMirrorTest} for the subscription half — and what was copied
 * between them is not a line but a delivery: the URI, the header, the body as bytes rather than as a bound
 * object, and the four ways a delivery can be wrong. It is {@link Relists}' argument about the gate's two
 * calls, applied to the one route no bearer token reaches.
 *
 * <p><strong>The signing is written out here rather than taken from Stripe's library</strong>, which is the
 * whole reason it is worth having: a suite that signed with the same code the application verifies with would
 * pass however wrong both of them were. HMAC-SHA256 over {@code timestamp.payload}, hex, under {@code v1} —
 * Stripe's published scheme, spelled from its documentation.
 *
 * <p>No request here carries a token, and that is load-bearing in both suites: this route is opened by name in
 * a filter chain in another module, so a chain that stopped opening exactly this path would refuse every
 * delivery in both of them with a 401 rather than fail in one place.
 */
final class StripeDeliveries {

	StripeDeliveries(int port, String secret) {
		this.webhook = URI.create("http://localhost:" + port + "/api/stripe/webhook");
		this.secret = secret;
	}

	/** An event as Stripe sends one: signed with the endpoint's secret, stamped now. */
	HttpResponse<String> delivered(String payload) {
		return deliveredWith(signatureOf(payload, this.secret, Instant.now()), payload);
	}

	/** A caller that signed nothing, which is the same refusal as one that signed wrongly. */
	HttpResponse<String> deliveredUnsigned(String payload) {
		return deliveredWith(null, payload);
	}

	/** Somebody who knows the shape of an event and not the secret. */
	HttpResponse<String> deliveredSignedWith(String someOtherSecret, String payload) {
		return deliveredWith(signatureOf(payload, someOtherSecret, Instant.now()), payload);
	}

	/** A genuine event, signed at a moment of the caller's choosing — which is how a replay is arranged. */
	HttpResponse<String> deliveredAsIfSentAt(Instant when, String payload) {
		return deliveredWith(signatureOf(payload, this.secret, when), payload);
	}

	/**
	 * @param signature the header, or {@code null} to send none at all — omitted rather than sent empty, which
	 * is the distinction {@link Relists} draws about {@code Authorization} and the same one the application
	 * draws here
	 */
	HttpResponse<String> deliveredWith(String signature, String payload) {
		HttpRequest.Builder request = HttpRequest.newBuilder(this.webhook)
				.header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(payload, UTF_8));
		if (signature != null) {
			request.header("Stripe-Signature", signature);
		}
		return Http.send(request.build());
	}

	/** Stripe's scheme: HMAC-SHA256 over {@code timestamp.payload}, hex, under {@code v1}. */
	static String signatureOf(String payload, String secret, Instant when) {
		long timestamp = when.getEpochSecond();
		try {
			Mac hmac = Mac.getInstance("HmacSHA256");
			hmac.init(new SecretKeySpec(secret.getBytes(UTF_8), "HmacSHA256"));
			byte[] signed = hmac.doFinal((timestamp + "." + payload).getBytes(UTF_8));
			return "t=" + timestamp + ",v1=" + HexFormat.of().formatHex(signed);
		}
		catch (GeneralSecurityException impossible) {
			throw new IllegalStateException("HmacSHA256 is required of every JVM", impossible);
		}
	}

	private final URI webhook;

	private final String secret;

}
