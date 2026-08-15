package com.mprelist.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.server.resource.BearerTokenErrors;

/**
 * That the refusal's body and its status say the same thing.
 *
 * <p>The only test of this application's security that is not driven over a real port, and the reason is the
 * subject: {@code BearerTokenAuthenticationEntryPoint} takes its status from the {@code BearerTokenError} it
 * is handed, and the one that is not a {@code 401} cannot be arranged by a request. Both places
 * {@code DefaultBearerTokenResolver} raises {@code invalid_request} are behind the form-encoded and
 * query-parameter options, which this application leaves off, so a suite confined to HTTP could only assert
 * the pairing by turning on a setting the application does not ship.
 *
 * <p>Everything else about the refusal — that it is what an absent token, a rejected one and a subject-less
 * one all come back as — is {@code ResourceServerTest}'s, where the filter chain is really running.
 */
class ResourceServerSecurityTest {

	/**
	 * The ordinary case, restated here because it is what the test below is a departure from: a caller turned
	 * away is a {@code 401} carrying the contract's typed reason code.
	 */
	@Test
	void aCallerTurnedAwayGetsTheStatusAndTheReasonTogether() throws Exception {
		MockHttpServletResponse refusal = refuse(new InsufficientAuthenticationException("No bearer token"));

		assertThat(refusal.getStatus()).isEqualTo(401);
		assertThat(refusal.getContentAsString()).isEqualTo("{\"reason\":\"UNAUTHENTICATED\"}");
	}

	/**
	 * And a request the API could not parse is not a caller it turned away. {@code invalid_request} is a
	 * {@code 400}, which {@code docs/enforcement-contract.md} describes no denial for — so the challenge
	 * header says what was wrong and the body says nothing, rather than claiming a reason code the status
	 * contradicts.
	 */
	@Test
	void butAMalformedRequestIsNotOne() throws Exception {
		MockHttpServletResponse refusal = refuse(new OAuth2AuthenticationException(
				BearerTokenErrors.invalidRequest("Found multiple bearer tokens in the request")));

		assertThat(refusal.getStatus()).isEqualTo(400);
		assertThat(refusal.getContentAsString()).isEmpty();
		assertThat(refusal.getHeader("WWW-Authenticate")).contains("error=\"invalid_request\"");
	}

	private static MockHttpServletResponse refuse(AuthenticationException refused) throws Exception {
		MockHttpServletResponse refusal = new MockHttpServletResponse();
		ResourceServerSecurity.UNAUTHENTICATED.commence(new MockHttpServletRequest(), refusal, refused);
		return refusal;
	}

}
