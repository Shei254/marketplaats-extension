package com.mprelist.identity.internal;

import org.springframework.core.MethodParameter;
import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/**
 * The validated token the request being handled arrived with, or a refusal — the one guard both of this
 * module's argument resolvers fail closed through.
 *
 * <p>Written once because it is a guard. {@code CurrentUser} and {@code UserRef} are resolved by separate
 * classes and answer different questions, but "was this caller authenticated at all" has exactly one right
 * answer, and a second copy of it is a second thing that can be relaxed on its own.
 */
final class TokenOnThisRequest {

	/**
	 * <p>The refusal is an {@link AuthenticationCredentialsNotFoundException} rather than an
	 * {@code IllegalStateException} on purpose. It leaves the handler, is claimed by none of Spring MVC's
	 * exception resolvers, and so reaches {@code ExceptionTranslationFilter}, which hands it to the chain's
	 * authentication entry point — the contract's {@code 401 UNAUTHENTICATED} in the chain this application
	 * ships. A route that permits anonymous access and then asks who is calling therefore fails closed and in
	 * the shape every other denial has, rather than as a 500.
	 *
	 * @param parameter the parameter being resolved, named in the failure so the message says which handler
	 *                  asked
	 */
	static Jwt orRefuse(MethodParameter parameter) {
		if (!(SecurityContextHolder.getContext().getAuthentication() instanceof JwtAuthenticationToken caller)) {
			throw new AuthenticationCredentialsNotFoundException(
					"No validated token on this request, so there is no caller to hand " + parameter.getMethod()
							+ ". A route that permits anonymous access cannot ask who is calling.");
		}
		return caller.getToken();
	}

	private TokenOnThisRequest() {
	}

}
