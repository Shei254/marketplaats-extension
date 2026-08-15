package com.mprelist;

import static java.util.stream.Collectors.toCollection;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import com.mprelist.identity.CurrentUser;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The API as an OAuth2 resource server: which tokens get in, which are refused and in what shape, and who
 * the request turns out to be from (#19, ADR-0005).
 *
 * <p>Over a real port rather than through MockMvc, because the whole subject is a filter chain. MockMvc
 * installs Spring Security's filters only when {@code spring-security-test} happens to be on the classpath,
 * and a suite that quietly stopped running them would pass every test below by never refusing anything —
 * which is the one failure this file exists to make impossible.
 *
 * <p>The tokens come from {@link MintedTokens}, not from a Keycloak. Half of what has to be proven here is a
 * refusal, and an IdP will not mint the tokens that earn one: expired, for another audience, signed by a key
 * it never published. What ties the two together is that the realm's shape is not a free choice here —
 * {@code theIssuerThisApiTrustsIsTheRealmTheLocalStackServes} and the test after it hold
 * {@code application.yml} against the realm file and against compose, which is the seam a stub cannot cover
 * and a green suite would otherwise hide.
 *
 * <p>The routes are the fixtures below. This ticket ships no endpoint — {@code identity} answers no request
 * of its own — but "who is the caller" and "what does a refusal look like" are only observable through one,
 * so the suite brings its own and the application still ships none.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import({ PostgresFromCompose.class, ResourceServerTest.ProbeRoutes.class })
class ResourceServerTest {

	/**
	 * Started in a field initialiser rather than in a {@code @BeforeAll}, which is how every other fixture in
	 * this suite starts what it needs: {@link DynamicPropertySource} runs while the context is being built,
	 * which is before any lifecycle callback, and the issuer has to be serving by then or the property it
	 * registers names a port nothing answers on. Stopped in {@link #stopServingKeys()}, where the pairing is
	 * ordinary again.
	 */
	private static final MintedTokens IDP = MintedTokens.servingItsKeys();

	@DynamicPropertySource
	static void trustTheTokensThisSuiteMints(DynamicPropertyRegistry properties) {
		properties.add("spring.security.oauth2.resourceserver.jwt.issuer-uri", IDP::issuerUri);
	}

	@AfterAll
	static void stopServingKeys() {
		IDP.close();
	}

	@Test
	void theSubjectOfTheTokenIsWhoTheRequestIsFrom() {
		HttpResponse<String> answered = get(CALLER, IDP.token());

		assertThat(answered.statusCode()).isEqualTo(200);
		assertThat(json(answered).get("idpSubject").asString()).isEqualTo(MintedTokens.SUBJECT);
	}

	/**
	 * The claim carrying it is the one Keycloak writes for a single audience: a bare string, not a list of
	 * one. Asserted on the fixture rather than trusted, because a suite that only ever minted the array shape
	 * would leave a resource server that reads {@code aud} as a list untested against every token the realm's
	 * {@code dev} user can produce.
	 */
	@Test
	void andItsAudienceIsTheBareStringKeycloakWritesForOneAudience() {
		String token = IDP.token();

		assertThat(KeycloakFromCompose.claimsOf(token).get("aud").isString()).isTrue();
		assertThat(get(CALLER, token).statusCode()).isEqualTo(200);
	}

	/**
	 * The other shape, which is what a user holding the realm's default roles produces — those carry
	 * {@code account}'s client roles, so {@code aud} becomes an array with this API somewhere in it. A
	 * resource server that compared one string would pass the test above and fail against the first user made
	 * through a registration form.
	 */
	@Test
	void andNamingThisApiAmongOtherAudiencesIsEnough() {
		String token = IDP.token(claims -> claims.audience(List.of("account", MintedTokens.AUDIENCE)));

		assertThat(KeycloakFromCompose.claimsOf(token).get("aud").isArray()).isTrue();
		assertThat(get(CALLER, token).statusCode()).isEqualTo(200);
	}

	/**
	 * A realm role becomes the authority {@code hasRole('ADMIN')} asks for, which is the whole of what #27's
	 * guard will need from this module.
	 *
	 * <p>{@code FACTOR_BEARER} beside it is Spring Security 7's own: it records <em>how</em> the caller
	 * authenticated rather than what they may do, and it is on every authenticated request here because a
	 * bearer token is the only way in. Asserted rather than filtered out, so that this says what the set is
	 * instead of what it was hoped to be — and so that a release which stops granting it is noticed by a test
	 * rather than by whatever comes to depend on it.
	 */
	@Test
	void aRealmRoleBecomesTheAuthorityAGuardWouldAskFor() {
		String token = IDP.token(claims -> claims.claim("realm_access", Map.of("roles", List.of("ADMIN"))));

		assertThat(authorities(get(CALLER, token))).containsExactlyInAnyOrder(BEARER_FACTOR, "ROLE_ADMIN");
	}

	/**
	 * And a user holding none is still a caller, with nothing but that factor to their name. Keycloak omits
	 * {@code realm_access} altogether rather than sending an empty list, so this is not an edge case: until a
	 * second role exists, every user who is not an operator produces this token, which is why the realm ships
	 * {@code dev} holding nothing.
	 */
	@Test
	void andAUserWhoseTokenCarriesNoRolesAtAllIsStillOne() {
		HttpResponse<String> answered = get(CALLER, IDP.token());

		assertThat(answered.statusCode()).isEqualTo(200);
		assertThat(authorities(answered)).containsExactly(BEARER_FACTOR);
	}

	/**
	 * The refusal {@code docs/enforcement-contract.md} specifies, with the typed reason code every denial in
	 * that contract carries — {@code 401} is the one Spring Security would answer on its own, and the body is
	 * the part it would not. The challenge header goes with it, because a client that gets a 401 with no
	 * {@code WWW-Authenticate} is being told nothing about what would work.
	 */
	@Test
	void aCallWithNoTokenIsRefusedWithTheReasonEveryDenialCarries() {
		HttpResponse<String> refused = get(CALLER, null);

		assertThat(refused.statusCode()).isEqualTo(401);
		assertThat(json(refused).get("reason").asString()).isEqualTo("UNAUTHENTICATED");
		assertThat(refused.headers().firstValue("WWW-Authenticate")).hasValueSatisfying(
				challenge -> assertThat(challenge).startsWith("Bearer"));
		// Said rather than defaulted: a writer the container has not been told about is ISO-8859-1, which is a
		// content type to be reading JSON as long before any denial carries a value that is not ASCII.
		assertThat(refused.headers().firstValue("Content-Type"))
				.hasValueSatisfying(type -> assertThat(type).isEqualToIgnoringCase("application/json;charset=UTF-8"));
	}

	@Test
	void andSoIsOneCarryingSomethingThatIsNotAToken() {
		HttpResponse<String> refused = get(CALLER, "not-a-token");

		assertThat(refused.statusCode()).isEqualTo(401);
		assertThat(json(refused).get("reason").asString()).isEqualTo("UNAUTHENTICATED");
	}

	@Test
	void aTokenSignedByAKeyTheIssuerNeverPublishedIsNotOneItIssued() {
		assertThat(get(CALLER, IDP.tokenSignedByAKeyThisIssuerNeverPublished()).statusCode()).isEqualTo(401);
	}

	/**
	 * Expired by an hour, not by a second: the resource server allows 60 seconds of clock skew either way, so
	 * a token that expired a moment ago is one it is right to accept and this test would be asserting the
	 * skew rather than the expiry.
	 */
	@Test
	void andOneThatExpiredBeforeTheCallIsNotOneEither() {
		Instant anHourAgo = Instant.now().minus(Duration.ofHours(1));
		String token = IDP.token(claims -> claims.issueTime(Date.from(anHourAgo.minus(Duration.ofMinutes(5))))
				.expirationTime(Date.from(anHourAgo)));

		assertThat(get(CALLER, token).statusCode()).isEqualTo(401);
	}

	@Test
	void andOneMintedByAnIssuerThisApiDoesNotKnowIsRefusedToo() {
		assertThat(get(CALLER, IDP.token(claims -> claims.issuer("http://localhost:1/realms/somewhere-else")))
				.statusCode()).isEqualTo(401);
	}

	/**
	 * And one that is right in every way the decoder checks and still names nobody. {@code sub} is not among the
	 * claims {@code issuer-uri} and {@code audiences} buy — this token's signature, issuer, expiry and audience
	 * all pass — so it is the application that has to refuse it, and this asserts it does so as a refusal rather
	 * than as a 500 from a handler that was handed a caller it could not name.
	 *
	 * <p>No token the realm mints looks like this, which is the reason to pin it: Keycloak always writes
	 * {@code sub}, so the day one arrives without it is a day something else has already gone wrong, and the
	 * shape of the answer should not also be a surprise. Asserted on {@link #CALLER} — a route that does ask who
	 * is calling — but refused before any route is reached, because the check is on the way in.
	 */
	@Test
	void andOneThatNamesNoSubjectIsRefusedRatherThanHandedToAHandler() {
		HttpResponse<String> refused = get(CALLER, IDP.token(claims -> claims.subject(null)));

		assertThat(refused.statusCode()).isEqualTo(401);
		assertThat(json(refused).get("reason").asString()).isEqualTo("UNAUTHENTICATED");
	}

	/**
	 * And at a route that never asks who is calling, which is what makes this a check on the way in rather than
	 * the argument resolver's business. The discriminator is the test two up: an authenticated caller at an
	 * unknown route is told {@code 404}, so a {@code 401} here is the token being turned away before routing.
	 * Were the check moved into {@code CurrentUserFromToken}, this call would be answered {@code 404} — a caller
	 * the API could not name, admitted, because nothing on that route happened to ask for a name.
	 */
	@Test
	void andAtARouteThatNeverAsksWhoIsCalling() {
		HttpResponse<String> refused = get(NO_SUCH_ROUTE, IDP.token(claims -> claims.subject(null)));

		assertThat(refused.statusCode()).isEqualTo(401);
		assertThat(json(refused).get("reason").asString()).isEqualTo("UNAUTHENTICATED");
	}

	/**
	 * The check that is not the issuer's. Every client in the realm signs in against the same issuer and gets
	 * a token signed by the same key, so without an audience the dashboard's own token — or {@code account}'s,
	 * which Keycloak hands to anybody — would be one this API accepts. {@code mprelist-api} exists to be named
	 * here and nothing else; it registers no redirect URI and no browser login can be started as it.
	 */
	@Test
	void aTokenForSomebodyElsesAudienceIsRefusedThoughThisIssuerMintedIt() {
		assertThat(get(CALLER, IDP.token(claims -> claims.audience("somebody-elses-api"))).statusCode())
				.isEqualTo(401);
	}

	/**
	 * Default-deny, and the reason it is not scoped to {@code /api/**}: a route nobody has written yet is
	 * already closed, so opening one is a decision its own ticket has to take rather than an omission. The one
	 * route that is open without a ticket is the test after next, and it is not ours.
	 */
	@Test
	void everyRouteIsClosedUntilItsOwnTicketOpensIt() {
		HttpResponse<String> refused = get(NO_SUCH_ROUTE, null);

		assertThat(refused.statusCode()).isEqualTo(401);
		assertThat(json(refused).get("reason").asString()).isEqualTo("UNAUTHENTICATED");
	}

	/**
	 * And a caller who <em>is</em> signed in is told the route does not exist, rather than told to sign in
	 * again. Not a given: a 404 is dispatched back through the filter chain, and a chain that had forgotten
	 * who was calling would answer that dispatch with the 401 above — turning every error an authenticated
	 * call meets into a false sign-out, which is the one thing the extension's gate reads as "signed out"
	 * (#34).
	 */
	@Test
	void andAKnownCallerAtAnUnknownRouteIsToldItIsUnknown() {
		assertThat(get(NO_SUCH_ROUTE, IDP.token()).statusCode()).isEqualTo(404);
	}

	/**
	 * Except for the one route Spring Security publishes and opens for itself: RFC 9728 protected-resource
	 * metadata, which the {@code WWW-Authenticate} challenge on every refusal above points a client at.
	 *
	 * <p>Pinned because it was a surprise — found by curling the running application, not by reading the
	 * configuration, and the promise two tests up is that nothing is open here that a ticket did not open. It
	 * discloses the base URL the caller has just used and nothing else; in particular it names no
	 * authorization server, because none was configured for it to name. An upgrade that started publishing
	 * the issuer here would be widening what an unauthenticated caller learns, and this is what would say so.
	 */
	@Test
	void exceptForTheOneRouteSpringSecurityOpensForItself() {
		HttpResponse<String> metadata = get("/.well-known/oauth-protected-resource", null);

		assertThat(metadata.statusCode()).isEqualTo(200);
		assertThat(json(metadata).get("resource").asString()).isEqualTo("http://localhost:" + this.port);
		assertThat(metadata.body()).doesNotContain(IDP.issuerUri());
	}

	/**
	 * Both endpoints of the enforcement contract are POSTs, and CSRF protection is on by default. Nothing here
	 * is authenticated by a cookie, so there is nothing a cross-site form could ride — a browser sends our
	 * cookies unasked and never an {@code Authorization} header — and left on it would refuse every one of
	 * those calls for want of a token this API has no way to hand out.
	 */
	@Test
	void aPostNeedsNoCsrfTokenBecauseNoCookieAuthenticatesAnything() {
		HttpResponse<String> answered = post(CALLER, IDP.token());

		assertThat(answered.statusCode()).isEqualTo(200);
		assertThat(json(answered).get("idpSubject").asString()).isEqualTo(MintedTokens.SUBJECT);
	}

	/**
	 * And nothing is remembered between calls: no session cookie comes back, so the token is the whole of the
	 * caller's identity on every request. It matters at the other end — an MV3 worker has no cookie jar of its
	 * own for our origin and could not send one back.
	 */
	@Test
	void andNothingIsRememberedBetweenCalls() {
		assertThat(get(CALLER, IDP.token()).headers().allValues("Set-Cookie")).isEmpty();
	}

	/**
	 * A route that permits anonymous access cannot be told who the caller is — it is refused rather than
	 * handed a caller who was never authenticated, and it fails closed into the same refusal as a request with
	 * no token at all. There is no such route in this application today, so the fixture below adds one: a
	 * resolver that fails closed only where nothing exercises it is indistinguishable from one that hands back
	 * null and lets the handler run.
	 *
	 * <p>That the handler never ran is asserted directly, and it is the half that has to be. A resolver
	 * returning null blows up inside the handler instead, and the container dispatches that to {@code /error}
	 * — which this application also protects, so it comes back as the very same 401. The status alone cannot
	 * tell "refused" from "ran and threw".
	 */
	@Test
	void aRouteThatPermitsAnonymousAccessCannotBeToldWhoTheCallerIs() {
		int entered = Probe.ENTERED.get();

		HttpResponse<String> refused = get(ANONYMOUS_CALLER, null);

		assertThat(refused.statusCode()).isEqualTo(401);
		assertThat(json(refused).get("reason").asString()).isEqualTo("UNAUTHENTICATED");
		assertThat(Probe.ENTERED).hasValue(entered);
	}

	/**
	 * And that route really is open, or the test above proves nothing: a fixture chain that quietly stopped
	 * matching would leave the application's own chain to refuse the call before the handler was ever reached,
	 * which looks exactly like the resolver refusing it.
	 */
	@Test
	void andThatRouteIsOpenRatherThanRefusedBeforeItIsReached() {
		HttpResponse<String> answered = get(ANONYMOUS_SERVED, null);

		assertThat(answered.statusCode()).isEqualTo(200);
		assertThat(answered.body()).isEqualTo("served");
	}

	/**
	 * The pairing no container in this suite can check, and the one that breaks a developer's first sign-in:
	 * the issuer this application trusts is where the local stack serves the realm. Compose fixes it with
	 * {@code KC_HOSTNAME} precisely so that the value does not depend on which name a request arrived by, and
	 * a realm renamed or a port moved would otherwise leave this file behind silently.
	 *
	 * <p>Read out of {@code application.yml} rather than from the running configuration, because this suite
	 * overrides that property to point at its own issuer.
	 */
	@Test
	void theIssuerThisApiTrustsIsTheRealmTheLocalStackServes() {
		assertThat(configured("issuer-uri"))
				.isEqualTo(ComposeFile.setting("KC_HOSTNAME") + "/realms/" + KeycloakFromCompose.REALM);
	}

	/**
	 * And the audience it requires is the one the realm's mappers write. Both public clients carry an audience
	 * mapper and both name the same client; a third that named something else would mint tokens this API
	 * refuses, which is why this asserts every mapper in the file rather than the first.
	 */
	@Test
	void andTheAudienceItRequiresIsTheOneTheRealmsMappersWrite() {
		assertThat(audiencesTheRealmsMappersWrite()).isNotEmpty().containsOnly(configured("audiences"));
	}

	// --- the routes under test, which this application does not ship ------------------------------------

	@TestConfiguration(proxyBeanMethods = false)
	static class ProbeRoutes {

		@Bean
		Probe probe() {
			return new Probe();
		}

		/**
		 * The routes that permit anonymous access, ordered ahead of the application's own chain so that this
		 * matcher wins. They exist for two tests and are deliberately the only thing in this suite that
		 * configures security at all.
		 */
		@Bean
		@Order(0)
		SecurityFilterChain routesThatPermitAnonymousAccess(HttpSecurity http) throws Exception {
			return http.securityMatcher(ANONYMOUS + "/**")
					.authorizeHttpRequests(routes -> routes.anyRequest().permitAll())
					.build();
		}

	}

	@RestController
	static class Probe {

		@GetMapping(CALLER)
		Map<String, Object> caller(CurrentUser caller) {
			return Map.of("idpSubject", caller.idpSubject(), "authorities", authoritiesInContext());
		}

		/** The same answer on a POST, which is the method both endpoints of the enforcement contract use. */
		@PostMapping(CALLER)
		Map<String, Object> callerOnAPost(CurrentUser caller) {
			return caller(caller);
		}

		@GetMapping(ANONYMOUS_CALLER)
		Map<String, Object> anonymously(CurrentUser caller) {
			ENTERED.incrementAndGet();
			return caller(caller);
		}

		/** How often the handler above was entered, which is what "the resolver refused" actually means. */
		static final AtomicInteger ENTERED = new AtomicInteger();

		/** The same open chain, asking for nothing — which is what makes the route above provably open. */
		@GetMapping(ANONYMOUS_SERVED)
		String served() {
			return "served";
		}

		private static List<String> authoritiesInContext() {
			return SecurityContextHolder.getContext().getAuthentication().getAuthorities().stream()
					.map(GrantedAuthority::getAuthority).toList();
		}

	}

	// --- the calls themselves ---------------------------------------------------------------------------

	private HttpResponse<String> get(String path, String token) {
		return Http.send(request(path, token).GET().build());
	}

	private HttpResponse<String> post(String path, String token) {
		return Http.send(request(path, token).POST(HttpRequest.BodyPublishers.noBody()).build());
	}

	private HttpRequest.Builder request(String path, String token) {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + this.port + path))
				.timeout(Duration.ofSeconds(20));
		return token == null ? request : request.header("Authorization", "Bearer " + token);
	}

	private static JsonNode json(HttpResponse<String> response) {
		return JSON.readTree(response.body());
	}

	private static List<String> authorities(HttpResponse<String> response) {
		return json(response).get("authorities").valueStream().map(JsonNode::asString).toList();
	}

	/** A value out of {@code application.yml}'s own text, which is the copy this suite does not override. */
	private static String configured(String key) {
		return YamlSetting.in(applicationYaml(), key, "application.yml");
	}

	private static String applicationYaml() {
		try (var yaml = ResourceServerTest.class.getResourceAsStream("/application.yml")) {
			return new String(yaml.readAllBytes());
		}
		catch (IOException unreadable) {
			throw new UncheckedIOException("Cannot read application.yml off the classpath", unreadable);
		}
	}

	/** Every {@code aud} the realm file's audience mappers put into a token. */
	private static Set<String> audiencesTheRealmsMappersWrite() {
		JsonNode realm = JSON.readTree(InfraFiles.textOf(InfraFiles.keycloakRealm()));
		return realm.get("clients").valueStream()
				.flatMap(client -> client.path("protocolMappers").valueStream())
				.filter(mapper -> "oidc-audience-mapper".equals(mapper.path("protocolMapper").asString()))
				.map(mapper -> mapper.path("config").path("included.client.audience").asString())
				.collect(toCollection(LinkedHashSet::new));
	}

	@LocalServerPort
	private int port;

	private static final String CALLER = "/probe/caller";

	private static final String ANONYMOUS = "/probe/anonymous";

	private static final String ANONYMOUS_CALLER = ANONYMOUS + "/caller";

	private static final String ANONYMOUS_SERVED = ANONYMOUS + "/served";

	private static final String NO_SUCH_ROUTE = "/no-ticket-has-written-this-one";

	/** Spring Security 7's record of how the caller authenticated; no guard in this repository asks for it. */
	private static final String BEARER_FACTOR = "FACTOR_BEARER";

	private static final JsonMapper JSON = JsonMapper.builder().build();

}
