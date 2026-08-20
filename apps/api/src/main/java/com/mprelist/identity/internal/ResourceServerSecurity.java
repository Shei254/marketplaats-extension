package com.mprelist.identity.internal;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.web.BearerTokenAuthenticationEntryPoint;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import com.mprelist.identity.RoutesNeedingARole;

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

	/**
	 * @param guarded what other modules have said about their own routes (#27). Each is applied before the
	 * catch-all below, since a rule stated after {@code anyRequest()} would never be reached — and the whole
	 * of what a module can say is "these paths need this role", so nothing contributed here can open a route
	 * that default-deny closed. An {@link ObjectProvider} rather than a {@code List}, which Spring treats as
	 * a required dependency: a module publishing no rule would otherwise be an application that will not
	 * start, and the message it would fail with names a type nobody looking for the cause has heard of
	 */
	@Bean
	SecurityFilterChain everyRouteNeedsAToken(HttpSecurity http, ObjectProvider<RoutesNeedingARole> guarded,
			UrlBasedCorsConfigurationSource browsersThatMayCall) throws Exception {
		return http
				// Default-deny, and deliberately not scoped to /api/**: a route added by a later ticket is
				// then closed until that ticket opens it, rather than open until someone notices. #36's
				// client config is the first that may want opening, and it can say so itself.
				.authorizeHttpRequests(routes -> {
					guarded.orderedStream()
							.forEach(rule -> routes.requestMatchers(rule.pattern()).hasRole(rule.realmRole()));
					routes.anyRequest().authenticated();
				})
				// One entry point, and it is the chain's: a call with no Authorization header at all — the
				// commonest 401 there is — is refused in the same shape as one whose token was rejected,
				// rather than through Spring Security's default, which answers 403 with no body.
				.oauth2ResourceServer(resourceServer -> resourceServer
						.jwt(jwt -> jwt.jwtAuthenticationConverter(aTokenBecomesTheCallerItNames()))
						.authenticationEntryPoint(UNAUTHENTICATED))
				// The preflight a browser sends before every call this API takes — `Authorization` is
				// never a safelisted header — is answered here, by a filter that runs *before*
				// authentication and does not continue the chain. That ordering is the whole fix: a
				// preflight carries no token by design, so a chain that authenticated it first would refuse
				// it with the 401 above and the browser would report a missing CORS header. Which origins,
				// and with what, is `CrossOriginCallers`.
				//
				// Handed the source rather than left to `Customizer.withDefaults()`, which looks for a bean
				// *named* `corsConfigurationSource` and, finding none, silently falls back to whatever the
				// MVC introspector knows — which is nothing, and answers a preflight `200` with no CORS
				// headers on it at all. That is the shape of the bug this fixes, so it is not one to leave
				// depending on a name — and the fallback is not hypothetical: Spring MVC publishes a
				// `CorsConfigurationSource` of its own, which is what `withDefaults()` finds instead.
				.cors(cors -> cors.configurationSource(browsersThatMayCall))
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
	 * What a validated token becomes: the caller it names, holding the realm's roles as authorities.
	 *
	 * <p>Wired here rather than left to {@code Customizer.withDefaults()} and a {@link JwtAuthenticationConverter}
	 * bean, because the subject check below has nowhere else to go — that class declares {@code convert} final,
	 * so the only seams it offers are the claim converters, and refusing a token is not what an authorities
	 * converter is for.
	 */
	private static Converter<Jwt, AbstractAuthenticationToken> aTokenBecomesTheCallerItNames() {
		JwtAuthenticationConverter roles = new JwtAuthenticationConverter();
		roles.setJwtGrantedAuthoritiesConverter(ResourceServerSecurity::realmRolesOf);
		return token -> {
			requireASubject(token);
			return roles.convert(token);
		};
	}

	/**
	 * A token that is valid in every way the decoder checks and still names nobody is refused while this is
	 * still authentication, rather than wherever it first turns out to matter.
	 *
	 * <p>{@code sub} is not among the claims {@code issuer-uri} and {@code audiences} buy: those check the
	 * signature, the issuer, the expiry and the audience, and a token missing this one passes all four. Keycloak
	 * always writes it, so nothing in the realm produces such a token today — which is the reason to decide what
	 * happens rather than leave it to be discovered. Left to {@code CurrentUser}'s own guard it would be an
	 * {@code IllegalArgumentException} raised inside the handler, and a handler that throws leaves as a 500
	 * instead of as the refusal {@code docs/enforcement-contract.md} specifies.
	 *
	 * <p>Here and not in {@link CurrentUserFromToken}, because the resolver runs only for a route that asks who
	 * is calling: a guard there would leave every other route admitting a caller this API cannot name —
	 * including one carrying {@code realm_access}, which #27's {@code hasRole('ADMIN')} would then honour.
	 *
	 * <p>{@link InvalidBearerTokenException} rather than any other, because it is an
	 * {@code AuthenticationException}: the bearer filter hands it to the same entry point every other refusal
	 * passes through, so this comes back as the contract's {@code 401 UNAUTHENTICATED} with the
	 * {@code WWW-Authenticate} challenge saying which way this particular token was wrong.
	 */
	private static void requireASubject(Jwt token) {
		String subject = token.getSubject();
		if (subject == null || subject.isBlank()) {
			throw new InvalidBearerTokenException(
					"The token names no subject, so there is no caller for it to authenticate");
		}
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
	 *
	 * <p>Which is why the body then follows the status rather than being written regardless. That entry point
	 * takes its status from the {@code BearerTokenError} it was handed, and {@code invalid_request} is a
	 * {@code 400} — a status {@code docs/enforcement-contract.md} describes no denial for, because a request
	 * this API could not parse is not a caller it turned away. Nothing configured here reaches that today:
	 * both places {@code DefaultBearerTokenResolver} raises it are behind the form-encoded and query-parameter
	 * options, and both stay off. Written this way so that turning one on, or a release that raises a third
	 * such error, cannot quietly produce a {@code 400} carrying {@code UNAUTHENTICATED} — a pair no client
	 * reading that contract would know what to do with.
	 */
	private static void unauthenticated(HttpServletRequest request, HttpServletResponse response,
			AuthenticationException refused) throws IOException, ServletException {
		CHALLENGE.commence(request, response, refused);
		if (response.getStatus() != HttpServletResponse.SC_UNAUTHORIZED) {
			return;
		}
		response.setContentType(MediaType.APPLICATION_JSON_VALUE);
		// Said rather than left to the container, which defaults a writer to ISO-8859-1 and would advertise
		// `application/json;charset=ISO-8859-1` — a content type no reason code needs, and one that would start
		// mattering the moment a denial carries a value that is not ASCII.
		response.setCharacterEncoding(StandardCharsets.UTF_8.name());
		response.getWriter().write("{\"reason\":\"UNAUTHENTICATED\"}");
	}

	/**
	 * Package-private rather than private for {@code ResourceServerSecurityTest}, which drives it with the one
	 * refusal no request over a real port can arrange — see the second paragraph of {@link #unauthenticated}.
	 */
	static final AuthenticationEntryPoint UNAUTHENTICATED = ResourceServerSecurity::unauthenticated;

	private static final AuthenticationEntryPoint CHALLENGE = new BearerTokenAuthenticationEntryPoint();

	private static final String REALM_ACCESS_CLAIM = "realm_access";

	/** What {@code hasRole('ADMIN')} expands to, and the reason this converter exists at all. */
	private static final String ROLE_PREFIX = "ROLE_";

}
