package com.mprelist.billing.internal;

import java.util.Optional;

import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.mprelist.identity.UserRef;

/**
 * {@code POST /api/portal} — where "manage billing" becomes a Stripe page (T21, #31).
 *
 * <p><strong>Called by the popup</strong>, which holds an access token already and opens the returned URL in a
 * tab exactly as it opens a Checkout one; {@code apps/web} has no customer login and never calls this
 * (ADR-0017). The popup closes when the tab takes focus, which is why the Portal is given a page of
 * {@code apps/web}'s to return to rather than anything of the extension's.
 *
 * <p><strong>A POST, because it creates something.</strong> The session is a short-lived single-use resource at
 * Stripe, so two calls are two sessions and neither is a repeat of the other — which is what makes this not a
 * {@code GET}, in spite of reading like one. Who the caller is comes from the token, and what happens next is
 * entirely Stripe's dashboard configuration. <strong>The body is optional</strong> and says one thing since T96
 * (ADR-0043): the {@code language} the Portal is shown in, {@code nl} or {@code en}. No body, or none named, is
 * what every request was before; any other code is a {@code 400} with an empty body.
 *
 * <p><strong>Three answers.</strong> {@code 200} carries the URL. {@code 404} means this account has never
 * been billed, so Stripe holds no customer and there is nothing to manage — the ordinary state of a free user
 * who never bought anything, and not an error. {@code 503} means Stripe could not be asked, which is the only
 * one of the three a retry fixes. Both refusals carry an empty body: they are not denials about the user, so
 * there is no {@code reason} to read, exactly as {@code docs/enforcement-contract.md} says of every
 * {@code 4xx} that is not one.
 *
 * <p>It grants nothing and revokes nothing. Whatever the user does at Stripe comes back through the webhook
 * (T20, #30), which is the only thing in this application that moves anybody's plan.
 */
@RestController
class StartPortal {

	StartPortal(OpenPortal portal) {
		this.portal = portal;
	}

	/**
	 * @param subscriber whoever the token names. Asking for a {@link UserRef} is also what provisions the
	 * account on a first sight of a subject (#20), so a caller with no row yet is answered "nothing to manage"
	 * rather than failing on a missing account
	 */
	@PostMapping(path = PATH)
	ResponseEntity<PortalSession> start(UserRef subscriber, @RequestBody(required = false) PortalRequest request) {
		String code = request == null ? null : request.language();
		Optional<Language> language = Language.named(code);
		if (code != null && language.isEmpty()) {
			return ResponseEntity.badRequest().build();
		}
		return switch (this.portal.open(subscriber, language)) {
			case Portal.Opened opened -> ResponseEntity.ok(new PortalSession(opened.url()));
			case Portal.NothingToManage ignored -> ResponseEntity.notFound().build();
			case Portal.Unavailable ignored -> ResponseEntity.status(503).build();
		};
	}

	/** What the popup or the site may say about the Portal it wants: its Language, and nothing else. */
	record PortalRequest(String language) {
	}

	/**
	 * Where to send the browser. A one-field object rather than the bare string, for the reason every other
	 * answer here is one: a body that is a string cannot grow a field without breaking every client that reads
	 * it. The same shape {@code POST /api/checkout} answers with, and deliberately a separate type — the two
	 * are separate promises, and merging them would make either one's change the other's.
	 */
	record PortalSession(String url) {
	}

	private final OpenPortal portal;

	static final String PATH = "/api/portal";

}

/**
 * The {@code 400} this route answers when a body was sent and is not JSON of the shape above — empty, for the
 * reason {@code UnreadableCheckoutRequests} gives, and scoped to this controller for the same one.
 */
@RestControllerAdvice(assignableTypes = StartPortal.class)
class UnreadablePortalRequests {

	@ExceptionHandler(HttpMessageNotReadableException.class)
	ResponseEntity<Void> theRequestCouldNotBeRead(HttpMessageNotReadableException unreadable) {
		return ResponseEntity.badRequest().build();
	}

}
