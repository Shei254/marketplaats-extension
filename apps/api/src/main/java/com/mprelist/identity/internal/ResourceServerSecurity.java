package com.mprelist.identity.internal;

import java.io.IOException;
import java.util.Collection;
import java.util.List;
import java.util.Map;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.web.BearerTokenAuthenticationEntryPoint;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * The API as an OAuth2 resource server (ADR-0005): a Keycloak-issued access token is the only way in, and
 * every route is closed until one arrives.
 *
 * <p>The decoder itself is not built here. {@code spring.security.oauth2.resourceserver.jwt.issuer-uri} and
 * {@code .audiences} in {@code application.yml} are what Boot builds it from, which is why the signature,
 * the issuer, the expiry and the audience are checked by code that is not in this file. What is asserted is
 * the behaviour — {@code ResourceServerTest} mints tokens that are wrong one way each and expects them
 * refused — because a property silently dropped and a validator never installed look identical from here.
 */
@Configuration(proxyBeanMethods = false)
class ResourceServerSecurity {

	@Bean
	SecurityFilterChain everyRouteNeedsAToken(HttpSecurity http) throws Exception {
		return http
				// Default-deny, and deliberately not scoped to /api/**: a route added by a later ticket is
				// then closed until that ticket opens it, rather than open until someone notices. #36's
				// client config is the first that may want opening, and it can say so itself.
				.authorizeHttpRequests(routes -> routes.anyRequest().authenticated())
				// One entry point, and it is the chain's: a call with no Authorization header at all — the
				// commonest 401 there is — is refused in the same shape as one whose token was rejected,
				// rather than through Spring Security's default, which answers 403 with no body.
				.oauth2ResourceServer(resourceServer -> resourceServer
						.jwt(Customizer.withDefaults())
						.authenticationEntryPoint(UNAUTHENTICATED))
				// Nothing is remembered between calls: the token is the whole of the caller's identity and it
				// arrives on every request. It matters at the other end, where an MV3 worker has no cookie
				// jar of its own for our origin and could not send one back. Said here rather than left to
				// the bearer filter's own habit of keeping the context in a request attribute, because the
				// promise is this application's to keep and not that filter's to change.
				.sessionManagement(sessions -> sessions.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
				// No cookie authenticates anything here, so there is nothing for a cross-site form to ride: a
				// browser sends our cookies unasked and never an Authorization header a script had to write.
				// The resource-server configurer already exempts any request that carries a bearer token,
				// which is every request the contract makes today; this line is what will still hold for the
				// first POST that does not carry one — #30's Stripe webhook, which would otherwise be refused
				// for want of a CSRF token this API has no way to hand Stripe.
				.csrf(AbstractHttpConfigurer::disable)
				.build();
	}

	/**
	 * Keycloak's realm roles as Spring Security authorities, so #27's guard can be the ordinary
	 * {@code hasRole('ADMIN')} rather than something that reads claims for itself.
	 *
	 * <p>Reading the claim by hand rather than through
	 * {@code spring.security.oauth2.resourceserver.jwt.authorities-claim-expressions} is about the user who
	 * holds no role: Keycloak omits {@code realm_access} entirely rather than sending an empty list, and the
	 * SpEL that expression compiles to answers that by throwing and having the exception swallowed. Here it
	 * is a case rather than an accident. That user is not exotic — until a second role exists, every user
	 * who is not an operator is one, which is why the realm ships {@code dev} holding nothing.
	 *
	 * <p>This is the one place that knows how the IdP spells a role, which is what ADR-0012 means by keeping
	 * Keycloak an adapter: swapping it is a new converter here and nothing anywhere else.
	 */
	@Bean
	JwtAuthenticationConverter realmRolesAreAuthorities() {
		JwtAuthenticationConverter authentication = new JwtAuthenticationConverter();
		authentication.setJwtGrantedAuthoritiesConverter(ResourceServerSecurity::realmRolesOf);
		return authentication;
	}

	private static Collection<GrantedAuthority> realmRolesOf(Jwt token) {
		Map<String, Object> realmAccess = token.getClaimAsMap(REALM_ACCESS_CLAIM);
		if (realmAccess == null || !(realmAccess.get("roles") instanceof Collection<?> roles)) {
			return List.of();
		}
		return roles.stream().map(String::valueOf)
				.map(role -> (GrantedAuthority) new SimpleGrantedAuthority(ROLE_PREFIX + role)).toList();
	}

	/**
	 * The refusal {@code docs/enforcement-contract.md} names: {@code 401} carrying the typed reason code
	 * every denial in that contract carries, so the extension's gate (#34) reads one shape for all of them
	 * rather than special-casing the one Spring Security writes.
	 *
	 * <p>It delegates first, because {@link BearerTokenAuthenticationEntryPoint} is what sets the status and
	 * the {@code WWW-Authenticate} challenge RFC 6750 requires — including, for a token that was presented
	 * and rejected, which way it was wrong. That belongs in a header rather than in the body: the body is
	 * read by our own client, and telling an expired token from a malformed one is not something it acts on.
	 */
	private static void unauthenticated(HttpServletRequest request, HttpServletResponse response,
			AuthenticationException refused) throws IOException, ServletException {
		CHALLENGE.commence(request, response, refused);
		response.setContentType(MediaType.APPLICATION_JSON_VALUE);
		response.getWriter().write("{\"reason\":\"UNAUTHENTICATED\"}");
	}

	private static final AuthenticationEntryPoint UNAUTHENTICATED = ResourceServerSecurity::unauthenticated;

	private static final AuthenticationEntryPoint CHALLENGE = new BearerTokenAuthenticationEntryPoint();

	private static final String REALM_ACCESS_CLAIM = "realm_access";

	/** What {@code hasRole('ADMIN')} expands to, and the reason this converter exists at all. */
	private static final String ROLE_PREFIX = "ROLE_";

}
