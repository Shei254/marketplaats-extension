package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.mprelist.identity.RoutesNeedingARole;

/**
 * The {@code ADMIN} guard on {@code /api/admin} (#27, T18): who reaches it, who is turned away, and in what
 * shape.
 *
 * <p><strong>This ticket ships the guard and no endpoint</strong>, exactly as #19 shipped a resource server
 * and no endpoint — so the routes below are the suite's own and the application still serves none. That is
 * not a workaround, it is the claim being made: the guard covers {@code /api/admin/**} rather than a list of
 * handlers, so a route nobody has written yet is already closed, and T53's tier CRUD will be guarded by being
 * there rather than by remembering to ask.
 *
 * <p>Over a real port rather than through MockMvc, for the reason {@link ResourceServerTest} gives at length:
 * the whole subject is a filter chain, and a suite that quietly stopped running the filters would pass every
 * test here by never refusing anything.
 *
 * <p>The tokens are minted rather than fetched from Keycloak. What ties them to the real realm is
 * {@code KeycloakRealmTest}, which asserts {@code dev-admin} carries {@code ADMIN} and {@code dev} carries
 * nothing — the two shapes below stand for.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import({ PostgresFromCompose.class, AdminGuardTest.AdminFixtureRoutes.class })
class AdminGuardTest {

	private static final MintedTokens IDP = MintedTokens.servingItsKeys();

	@DynamicPropertySource
	static void trustTheTokensThisSuiteMints(DynamicPropertyRegistry properties) {
		IDP.trustedAsTheIssuer(properties);
	}

	@AfterAll
	static void stopServingKeys() {
		IDP.close();
	}

	@Test
	void anOperatorReachesTheAdminApi() {
		int entered = AdminProbe.ENTERED.get();

		HttpResponse<String> answered = get(ADMIN_ROUTE, operator());

		assertThat(answered.statusCode()).isEqualTo(200);
		assertThat(answered.body()).isEqualTo("served");
		assertThat(AdminProbe.ENTERED).hasValue(entered + 1);
	}

	/**
	 * And a caller holding no role is refused <em>before</em> the handler, which is the half that has to be
	 * asserted directly. A guard that answered 403 after running the handler would look identical from the
	 * outside and would already have done whatever the handler does — for T53 that is an edit to the tier
	 * catalog every subscriber is priced by.
	 */
	@Test
	void andACallerWithoutTheRoleIsRefusedBeforeItRuns() {
		int entered = AdminProbe.ENTERED.get();

		HttpResponse<String> refused = get(ADMIN_ROUTE, IDP.token());

		assertThat(refused.statusCode()).isEqualTo(403);
		assertThat(AdminProbe.ENTERED).hasValue(entered);
	}

	/**
	 * A caller who holds some other realm role is no closer than one holding none. Not a given: an
	 * authorities converter that mapped every role to the same authority, or a rule written as
	 * {@code authenticated()}, would pass the test above and fail this one.
	 */
	@Test
	void andSoIsOneHoldingSomeOtherRole() {
		assertThat(get(ADMIN_ROUTE, memberOf("SUPPORT")).statusCode()).isEqualTo(403);
	}

	/**
	 * The refusal carries nothing to parse, which is the rule {@code docs/enforcement-contract.md} states for
	 * a {@code 4xx} that is not one of its denials — and in particular no {@code reason}, since a client
	 * reads the presence of one as meaning it was turned away by the gate. Without this the answer would be
	 * Spring Boot's error representation, {@code {timestamp, status, error, path}}, which echoes the caller's
	 * own request path back at them.
	 */
	@Test
	void andTheRefusalCarriesNothingToParse() {
		HttpResponse<String> refused = get(ADMIN_ROUTE, IDP.token());

		assertThat(refused.body()).isEmpty();
	}

	/**
	 * A call with no token at all is the contract's {@code 401 UNAUTHENTICATED}, not this {@code 403}. The
	 * two are different instructions: one says sign in, the other says you are signed in as somebody who may
	 * not do this, and a client that could not tell them apart would send an operator round the sign-in loop
	 * for ever.
	 */
	/**
	 * It does carry a {@code WWW-Authenticate} challenge, which is the one place this answer departs from the
	 * letter of {@code docs/enforcement-contract.md} — that document says the challenge belongs to the
	 * {@code 401} and to nothing else. Written about the two answers #23 and #24 shipped, both of which this
	 * application writes by hand; this one is the resource server's, and RFC 6750 §3.1 defines
	 * {@code insufficient_scope} on a {@code 403} for exactly this case. Pinned rather than stripped: a
	 * standards-defined header is not worth a handler of our own to remove, and the contract is amended to say
	 * so instead.
	 */
	@Test
	void andTheChallengeOnItIsTheOneRfc6750DefinesForThisStatus() {
		HttpResponse<String> refused = get(ADMIN_ROUTE, IDP.token());

		assertThat(refused.headers().firstValue("WWW-Authenticate")).hasValueSatisfying(
				challenge -> assertThat(challenge).startsWith("Bearer error=\"insufficient_scope\""));
	}

	@Test
	void aCallWithNoTokenIsStillToldToSignIn() {
		HttpResponse<String> refused = get(ADMIN_ROUTE, null);

		assertThat(refused.statusCode()).isEqualTo(401);
		assertThat(Json.of(refused).get("reason").asString()).isEqualTo("UNAUTHENTICATED");
	}

	/**
	 * A path under {@code /api/admin} that nothing serves is refused all the same — the guard is on the way
	 * in, before routing, so it covers the routes T53 has not written yet. This is the property the whole
	 * ticket is: a rule over a path space rather than over a list of handlers.
	 */
	@Test
	void aPathNobodyHasWrittenYetIsAlreadyClosed() {
		assertThat(get(UNWRITTEN_ADMIN_ROUTE, IDP.token()).statusCode()).isEqualTo(403);
	}

	/**
	 * And the discriminator that makes the test above mean something: to an operator, that same path is a
	 * {@code 404}. A guard that answered {@code 403} for everything, or a chain that had stopped routing,
	 * would look the same from the previous test alone.
	 */
	@Test
	void andToAnOperatorItIsSimplyNotThere() {
		assertThat(get(UNWRITTEN_ADMIN_ROUTE, operator()).statusCode()).isEqualTo(404);
	}

	/**
	 * The guard is scoped, which is the other half of "closed to anyone else": a rule that had swallowed the
	 * whole application would pass every test above and lock every user out of {@code /api/me}.
	 */
	@Test
	void andEverywhereElseIsUntouched() {
		HttpResponse<String> answered = get(ORDINARY_ROUTE, IDP.token());

		assertThat(answered.statusCode()).isEqualTo(200);
		assertThat(answered.body()).isEqualTo("served");
	}

	/**
	 * And the rule itself refuses to be written wrong. Both halves fail the same way if they are missing —
	 * closed to everybody, or guarding nothing — and both are silent: a rule naming no role compiles to
	 * {@code hasRole("")}, an authority no token in the realm carries.
	 */
	@Test
	void aRuleThatWouldGuardNothingOrEverybodyIsNotOne() {
		assertThatThrownBy(() -> new RoutesNeedingARole(" ", "ADMIN"))
				.isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> new RoutesNeedingARole("/api/admin/**", null))
				.isInstanceOf(IllegalArgumentException.class);
	}

	// --- the routes under test, which this application does not ship ------------------------------------

	@TestConfiguration(proxyBeanMethods = false)
	static class AdminFixtureRoutes {

		@Bean
		AdminProbe adminProbe() {
			return new AdminProbe();
		}

	}

	@RestController
	static class AdminProbe {

		@GetMapping(ADMIN_ROUTE)
		String underTheAdminApi() {
			ENTERED.incrementAndGet();
			return "served";
		}

		@GetMapping(ORDINARY_ROUTE)
		String outsideIt() {
			return "served";
		}

		/** How often the guarded handler was entered, which is what "refused before it runs" means. */
		static final AtomicInteger ENTERED = new AtomicInteger();

	}

	// --- the calls themselves ---------------------------------------------------------------------------

	private String operator() {
		return memberOf("ADMIN");
	}

	private String memberOf(String realmRole) {
		return IDP.token(claims -> claims.claim("realm_access", Map.of("roles", List.of(realmRole))));
	}

	private HttpResponse<String> get(String path, String token) {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + this.port + path))
				.timeout(Duration.ofSeconds(20));
		if (token != null) {
			request.header("Authorization", "Bearer " + token);
		}
		return Http.send(request.GET().build());
	}

	@LocalServerPort
	private int port;

	private static final String ADMIN_ROUTE = "/api/admin/probe";

	/** Under the guarded path space and mapped to nothing — which is every route T53 has not written yet. */
	private static final String UNWRITTEN_ADMIN_ROUTE = "/api/admin/tiers";

	private static final String ORDINARY_ROUTE = "/probe-outside-the-admin-api";

}
