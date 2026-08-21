package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
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

/**
 * The backward-compatibility lever (T43, #52): what this API does about a client build older than the one it
 * still serves.
 *
 * <p>The minimum is set to {@code 1.2.0} for this suite because the shipped value is {@code 0} — every build
 * there has ever been — and a lever that is never pulled cannot be tested by pulling nothing.
 *
 * <p>Over a real port, like {@link AdminGuardTest} and for its reason: the subject is something that happens
 * to a request before a handler sees it, and a suite that had quietly stopped running the interceptor would
 * pass every test here by refusing nobody. The route below is this suite's own — the lever is about
 * {@code /api/**} as a whole, not about any endpoint the contract names.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = "mprelist.clients.minimum-extension-version=1.2.0")
@Import({ PostgresFromCompose.class, ClientVersionTest.ProbeRoute.class })
class ClientVersionTest {

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
	void anExtensionOlderThanTheMinimumIsRefusedBeforeItsRequestRuns() {
		int entered = Probe.ENTERED.get();

		HttpResponse<String> refused = get("extension/1.1.9");

		assertThat(refused.statusCode()).isEqualTo(426);
		assertThat(Probe.ENTERED).hasValue(entered);
	}

	/**
	 * And carries nothing to parse, which is the rule {@code docs/enforcement-contract.md} states for a
	 * {@code 4xx} that is not one of its denials — in particular **no `reason`**, since a client reads the
	 * presence of one as meaning the gate turned the *user* away. This is about their software.
	 */
	@Test
	void andCarriesNoReasonToRead() {
		assertThat(get("extension/1.1.9").body()).isEmpty();
	}

	@Test
	void theMinimumItselfIsServed() {
		// The boundary, in the direction that matters: "minimum supported" has to include the version named,
		// or the number in the config means one release later than whoever set it thinks.
		assertThat(served("extension/1.2.0")).isTrue();
	}

	@Test
	void andSoIsAnythingNewer() {
		assertThat(served("extension/1.2.1")).isTrue();
		assertThat(served("extension/2.0")).isTrue();
		assertThat(served("extension/1.10.0")).isTrue();
	}

	/**
	 * A component nobody wrote is a zero, which is Chrome's own rule — so {@code 1.2} and {@code 1.2.0} are
	 * one release rather than two, and the shorter form is not quietly the older one.
	 */
	@Test
	void andAVersionWrittenShortIsTheSameRelease() {
		assertThat(served("extension/1.2")).isTrue();
		assertThat(served("extension/1.1")).isFalse();
	}

	/**
	 * A caller that names no release is served — {@code apps/web} does not send one yet, {@code curl} never
	 * will, and **every extension built before this ticket cannot**. That last one is the honest limit of the
	 * whole mechanism: the lever only reaches builds that already identify themselves, which is the argument
	 * for shipping the header before there are users rather than after.
	 */
	@Test
	void aCallerThatNamesNoReleaseIsServed() {
		assertThat(served(null)).isTrue();
	}

	@Test
	void andSoIsOneWhoseHeaderIsNotShapedLikeAnything() {
		// Identification, not authentication. A header this API cannot read is a diagnostic it did not get,
		// and refusing traffic over a diagnostic would be the tail wagging the dog.
		assertThat(served("extension")).isTrue();
		assertThat(served("extension/")).isTrue();
		assertThat(served("extension/nightly")).isTrue();
		assertThat(served("/1.0.0")).isTrue();
		assertThat(served("extension/1.2.3.4.5")).isTrue();
	}

	/** Another surface's version is not the extension's, and this minimum is only about the extension. */
	@Test
	void andSoIsAnotherSurfaceEntirely() {
		assertThat(served("web/0.0.1")).isTrue();
	}

	/**
	 * Being signed out is answered first, and updating does not fix it. The interceptor runs after the
	 * security chain precisely so that an expired token and an old build are two different sentences.
	 */
	@Test
	void aCallerWithNoTokenIsToldThatFirst() {
		HttpRequest.Builder request = HttpRequest.newBuilder(uri(ROUTE)).timeout(TIMEOUT);
		request.header(CLIENT_HEADER, "extension/1.1.9");

		assertThat(Http.send(request.GET().build()).statusCode()).isEqualTo(401);
	}

	// --- the route under test, which this application does not ship --------------------------------------

	@TestConfiguration(proxyBeanMethods = false)
	static class ProbeRoute {

		@Bean
		Probe probe() {
			return new Probe();
		}

	}

	@RestController
	static class Probe {

		@GetMapping(ROUTE)
		String served() {
			ENTERED.incrementAndGet();
			return "served";
		}

		/** How often the handler ran, which is what "refused before its request runs" means. */
		static final AtomicInteger ENTERED = new AtomicInteger();

	}

	// --- the calls themselves -----------------------------------------------------------------------------

	private boolean served(String client) {
		HttpResponse<String> answered = get(client);
		return answered.statusCode() == 200 && "served".equals(answered.body());
	}

	private HttpResponse<String> get(String client) {
		HttpRequest.Builder request = HttpRequest.newBuilder(uri(ROUTE))
				.timeout(TIMEOUT)
				.header("Authorization", "Bearer " + IDP.token());
		if (client != null) {
			request.header(CLIENT_HEADER, client);
		}
		return Http.send(request.GET().build());
	}

	private URI uri(String path) {
		return URI.create("http://localhost:" + this.port + path);
	}

	@LocalServerPort
	private int port;

	private static final Duration TIMEOUT = Duration.ofSeconds(20);

	/**
	 * The header the extension sends, spelled here as a client would rather than imported: this suite is the
	 * other end of the wire, and a test that took the constant from the code under test would agree with a
	 * rename that broke every installed build.
	 */
	private static final String CLIENT_HEADER = "X-Mprelist-Client";

	private static final String ROUTE = "/api/probe-any-route";

}
