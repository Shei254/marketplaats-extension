package com.mprelist.billing.internal;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.mprelist.enforcement.ReasonCode;
import com.mprelist.identity.UserRef;

/**
 * {@code POST /api/checkout} — where a plan card becomes a payment (T19, #29).
 *
 * <p><strong>Called by the popup, not by a web page.</strong> It holds an access token already, and this
 * product has one sign-in (ADR-0017): {@code apps/web} has no login and never calls this. What comes back is
 * a URL the popup opens in a tab, at which point the popup closes — expected, and the reason T50's success
 * page exists to catch the browser.
 *
 * <p><strong>{@code 409 ALREADY_PAYING}</strong> (T83) refuses somebody Stripe is already billing, with the
 * contract's denial body: unlike the refusals below it is a statement about the caller, and what they want —
 * a different plan — is the Customer Portal's.
 *
 * <p><strong>Three other answers, and the statuses are the difference between them.</strong> {@code 200} carries
 * the URL. {@code 404} means nothing is on sale under that code — an unknown tier, an unpublished one, or a
 * draft — which is what a client holding yesterday's plan cards gets, and is not an error on either side.
 * {@code 503} means Stripe could not be asked, which is the only one of the three a retry fixes. Both
 * refusals carry an **empty body**: they are not denials about the user, so there is no {@code reason} to
 * read, exactly as {@code docs/enforcement-contract.md} says of every {@code 4xx} that is not one.
 *
 * <p>It spends nothing and grants nothing. A Checkout session is an offer to pay; the entitlement moves when
 * Stripe says the money did, through the webhook (T20, #30) and not through this answer.
 */
@RestController
class StartCheckout {

	StartCheckout(OpenCheckout checkout) {
		this.checkout = checkout;
	}

	/**
	 * @param buyer whoever the token names. Asking for a {@link UserRef} is also what provisions the account
	 * on a first sight of a subject (#20), so somebody who signs in and immediately buys is not a caller this
	 * has to have an account created for by hand
	 * @param request the tier code, which is the stable handle ADR-0014 makes the thing anything references —
	 * not the Stripe price id, which is ours to look up and would let a client name a Price we never published
	 */
	@PostMapping(path = PATH, consumes = MediaType.APPLICATION_JSON_VALUE)
	ResponseEntity<?> start(UserRef buyer, @RequestBody CheckoutRequest request) {
		if (request == null || request.tierCode() == null || request.tierCode().isBlank()
				|| request.interval() == null || request.interval().isBlank()) {
			// Not "not for sale": nothing was asked for at all, which is a request this API could not read.
			// The interval is as required as the code since T62 (#128) — a tier may be sold monthly and
			// annually, so a request naming only the tier names two prices, and defaulting to either would
			// charge somebody a rhythm they did not pick.
			return ResponseEntity.badRequest().build();
		}
		return switch (this.checkout.open(buyer, request.tierCode().strip(), request.interval().strip())) {
			case Checkout.Opened opened -> ResponseEntity.ok(new CheckoutSession(opened.url()));
			case Checkout.NotForSale ignored -> ResponseEntity.notFound().build();
			case Checkout.Unavailable ignored -> ResponseEntity.status(503).build();
			// The denial shape, and the one answer here that is about the caller rather than the plan or Stripe.
			case Checkout.AlreadyPaying ignored -> ResponseEntity.status(ReasonCode.ALREADY_PAYING.status())
					.body(new Denied(ReasonCode.ALREADY_PAYING));
		};
	}

	/**
	 * The body of this route's one denial, {@code {"reason":"ALREADY_PAYING"}} — {@code display}'s
	 * {@code Denied} again rather than shared, since that one is internal to its module; the <em>code</em> is
	 * the shared part.
	 */
	record Denied(ReasonCode reason) {
	}

	/**
	 * What the popup asks with: which plan, and at which rhythm.
	 *
	 * <p>{@code interval} arrived with T62 (#128), when a tier stopped being sold at one price. It is Stripe's
	 * vocabulary — {@code month}, {@code year} — and it is the catalog's copy of it that a client is given on
	 * a plan card and sends back here, so the two are always the same string.
	 */
	record CheckoutRequest(String tierCode, String interval) {
	}

	/**
	 * What it opens. A one-field object rather than the bare string, for the reason every other answer here is
	 * an object: a body that is a string cannot grow a field without breaking every client that reads it.
	 */
	record CheckoutSession(String url) {
	}

	private final OpenCheckout checkout;

	static final String PATH = "/api/checkout";

}

/**
 * The {@code 400} this route answers when the body is not JSON, or not JSON of the shape above.
 *
 * <p>An empty body, so that a {@code 4xx} which is not a denial carries nothing — the rule
 * {@code docs/enforcement-contract.md} states and the reason {@code enforcement} has one of these too. Without
 * it the answer would be Spring Boot's default representation, {@code {timestamp, status, error, path}}: a
 * second body shape on the same API, and one that echoes the caller's own request path back at them.
 *
 * <p>Scoped to this controller rather than declared globally, like its counterpart: an advice naming no types
 * decides the shape of every route in the application, including ones later modules write, which is the kind
 * of reach across a boundary the module layout exists to prevent — and one the build-time check cannot see,
 * because Spring wires it by annotation rather than by a type reference.
 */
@RestControllerAdvice(assignableTypes = StartCheckout.class)
class UnreadableCheckoutRequests {

	@ExceptionHandler(HttpMessageNotReadableException.class)
	ResponseEntity<Void> theRequestCouldNotBeRead(HttpMessageNotReadableException unreadable) {
		return ResponseEntity.badRequest().build();
	}

}
