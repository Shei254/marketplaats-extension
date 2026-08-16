package com.mprelist.enforcement.internal;

import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * The {@code 400} this module's two routes answer with when they could not read the request at all — a body
 * that is not JSON, a {@code jti} not shaped like one, a missing half, an outcome the contract does not name.
 *
 * <p><strong>An empty body, so that a {@code 4xx} which is not a denial carries nothing.</strong> That is the
 * rule {@code docs/enforcement-contract.md} states, and the {@code 404} for a {@code jti} naming no
 * reservation of the caller's already keeps it. Without this the {@code 400} was the only answer these routes
 * gave that nobody wrote: Spring Boot's default error representation, {@code {timestamp, status, error, path}}
 * — which names no {@code reason} and so did not break the letter of the contract, but is a second body shape
 * on the same two endpoints, and one that echoes the request path back to a caller who sent it.
 *
 * <p>No {@code WWW-Authenticate} either, on any of them. That challenge belongs to the {@code 401} and to
 * nothing else (RFC 6750): a caller here was authenticated, and named something this API could not read.
 *
 * <p>Scoped to this module's controllers rather than declared globally. A {@code @RestControllerAdvice} with
 * no types named would decide the shape of every route in the application, including ones later modules
 * write — which is exactly the kind of reach across a boundary ADR-0012 keeps out of {@code internal}, and
 * one the build-time check cannot see because Spring wires it by annotation rather than by a type reference.
 *
 * <p>Only the unreadable case is handled here. A caller posting a body that is not JSON at all is told
 * {@code 415} by Spring, which sets the {@code Accept} header RFC 9110 wants on one — a shape worth leaving to
 * the framework that gets it right rather than restating for the sake of symmetry.
 */
@RestControllerAdvice(assignableTypes = { AuthorizeRelist.class, CompleteRelist.class })
class UnreadableRequests {

	/**
	 * @param unreadable carries the parse failure, and is deliberately not rendered: what a client acts on is
	 * that the request was wrong, and Jackson's account of <em>where</em> would tell an adversary (ADR-0007)
	 * how this API's types are shaped. It stays in the log, where the exception is already reported
	 */
	@ExceptionHandler(HttpMessageNotReadableException.class)
	ResponseEntity<Void> theRequestCouldNotBeRead(HttpMessageNotReadableException unreadable) {
		return ResponseEntity.badRequest().build();
	}

}
