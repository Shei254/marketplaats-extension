package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import tools.jackson.databind.JsonNode;

/**
 * The gap between two reposts, set the way somebody actually sets it ({@code mprelist.client-config.pacing}).
 *
 * <p><strong>Two settings rather than a line of JSON</strong>, and that is the whole subject here. Everything
 * else {@code GET /api/client-config} serves moves when Marktplaats moves it; how long the extension waits
 * between two relists is a judgement that gets revisited — after a ban wave, or because a minute of watching
 * a countdown turned out to be too long — and a setting you have to re-paste a JSON document to change is a
 * setting that does not get changed.
 *
 * <p>Over a real port like {@link ClientConfigTest}, and for its reason: what has to be right is the bytes.
 * The client reads this window with a hand-written checker, so {@code min_ms} where it expects {@code minMs}
 * is a deployment that appears to have worked and paces nothing.
 *
 * <p>The refusals — half a window, one that runs backwards, one longer than the worker that has to wait it
 * out, and one set in both places at once — are in {@link ClientConfigWithoutADocumentTest}, where the
 * application is started rather than injected because failing to start is the behaviour under test.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "mprelist.client-config.document=", "mprelist.client-config.pacing.min-ms=10000",
				"mprelist.client-config.pacing.max-ms=30000" })
@Import(PostgresFromCompose.class)
class ClientConfigPacingTest {

	private static final MintedTokens IDP = MintedTokens.servingItsKeys();

	@DynamicPropertySource
	static void trustTheTokensThisSuiteMints(DynamicPropertyRegistry properties) {
		IDP.trustedAsTheIssuer(properties);
	}

	@AfterAll
	static void stopServingKeys() {
		IDP.close();
	}

	/**
	 * Two properties in, one {@code pacing} block out — spelled the way the extension spells it, since that
	 * is the only spelling that does anything.
	 */
	@Test
	void aWindowSetAsTwoSettingsIsServedAsTheOneFieldTheClientReads() {
		JsonNode document = Json.of(get());

		assertThat(document.get("pacing").get("minMs").asLong()).isEqualTo(10_000);
		assertThat(document.get("pacing").get("maxMs").asLong()).isEqualTo(30_000);
		assertThat(get().body()).contains("\"minMs\"").doesNotContain("min_ms").doesNotContain("min-ms");
	}

	/**
	 * And nothing else is said. The window is a patch over the build's own defaults like every other field
	 * here (ADR-0013), so setting it does not turn this route into a configuration the client has to take
	 * whole — a deployment that tunes the pace still ships Marktplaats's paths as the extension knows them.
	 */
	@Test
	void andSettingItOverridesNothingElse() {
		JsonNode document = Json.of(get());

		assertThat(document.get("schemaVersion").asInt()).isEqualTo(1);
		assertThat(document.has("endpoints")).isFalse();
		assertThat(document.has("csrf")).isFalse();
	}

	private HttpResponse<String> get() {
		return Http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + this.port + "/api/client-config"))
				.timeout(Duration.ofSeconds(20))
				.header("Authorization", "Bearer " + IDP.token())
				.GET()
				.build());
	}

	@LocalServerPort
	private int port;

}
