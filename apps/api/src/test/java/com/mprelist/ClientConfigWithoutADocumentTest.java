package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import tools.jackson.databind.JsonNode;

/**
 * The application with nothing overridden, which is every deployment on every day Marktplaats has not moved
 * anything (T27, #36).
 *
 * <p><strong>The empty document is an answer, not an absence.</strong> {@code {"schemaVersion":1}} means "the
 * defaults you shipped with are correct" — so there is no {@code 404} and no {@code 503} here, and a client
 * that got one would have to decide whether to keep waiting for a document that is never coming.
 *
 * <p>Beside it, the case that must <strong>not</strong> answer at all: a document this API cannot read stops
 * it from starting. Those two are the whole of the setting's behaviour and they are opposite, which is why
 * they are asserted together — an application forgiving of a malformed document would let an operator deploy
 * a fix for a live breakage, see a green start, and go to bed.
 *
 * <p>A class of its own because the setting is what the context is built from, in the shape
 * {@link StripeWithoutAWebhookSecretTest} and {@link KeycloakRealmWithoutAnExtensionIdTest} already use.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = "mprelist.client-config.document=")
@Import(PostgresFromCompose.class)
class ClientConfigWithoutADocumentTest {

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
	void nothingOverriddenIsAnAnswerRatherThanAnAbsence() {
		HttpResponse<String> answered = get();
		JsonNode document = Json.of(answered);

		assertThat(answered.statusCode()).isEqualTo(200);
		assertThat(document.get("schemaVersion").asInt()).isEqualTo(1);
		assertThat(document.has("endpoints")).isFalse();
		assertThat(document.has("csrf")).isFalse();
		assertThat(document.has("pacing")).isFalse();
	}

	/**
	 * A document that is not JSON at all, which is the commonest way to get this wrong: a shell that ate the
	 * quotes, or a value pasted with a newline in it.
	 */
	@Test
	void andADocumentThatIsNotADocumentStopsTheApplicationStarting() {
		assertThatThrownBy(() -> startWith("{\"endpoints\":"))
				.hasStackTraceContaining("mprelist.client-config.document");
	}

	/**
	 * And a misspelt field, which is the way it will actually happen: {@code endpoint} for {@code endpoints}
	 * is a document that parses as JSON perfectly well and overrides nothing at all. Silently ignoring it
	 * would be the deploy that looked like it worked.
	 */
	@Test
	void andSoDoesAFieldNobodyServes() {
		assertThatThrownBy(() -> startWith("{\"endpoint\":{\"deleteAd\":\"/x\"}}"))
				.hasStackTraceContaining("mprelist.client-config.document")
				.hasStackTraceContaining("endpoint");
	}

	/**
	 * Including {@code schemaVersion} itself, which is the field an operator is likeliest to think is theirs:
	 * it is in every document they read back from this route. It names the shape this code serves, so setting
	 * it could only ever be a lie told to every installed client at once.
	 */
	@Test
	void andSoDoesAVersionAnOperatorTriedToSet() {
		assertThatThrownBy(() -> startWith("{\"schemaVersion\":2}"))
				.hasStackTraceContaining("mprelist.client-config.document")
				.hasStackTraceContaining("schemaVersion");
	}

	/** And a mode no client has a branch for — the whole of what keeps a served config data (ADR-0013). */
	@Test
	void andSoDoesACsrfModeNoClientCouldRun() {
		// And the refusal names the four modes there are, which is what an operator in the middle of an
		// outage needs rather than only the word they got wrong.
		assertThatThrownBy(() -> startWith("{\"csrf\":{\"mode\":\"eval\",\"header\":\"x\"}}"))
				.hasStackTraceContaining("mprelist.client-config.document")
				.hasStackTraceContaining("meta, cookie, fetch, none");
	}

	/**
	 * Started the way a deployment starts, rather than through the test context: what is under test is a
	 * failure to come up at all, and a context that fails to build is a suite that fails to run.
	 *
	 * <p>No web server and no database — this fails while beans are being built, long before either would be
	 * reached, and asking for them would make the assertion depend on Docker being up.
	 *
	 * <p>The document arrives as a command-line argument rather than a default property, and the difference is
	 * not a matter of style: {@code application.yml} is read <em>after</em> default properties and wins over
	 * them, so the first draft of this test started four applications configured with the empty document and
	 * watched all four come up. An argument is how a deployment overrides a file, which is also what the
	 * environment variable behind that line does.
	 */
	private static void startWith(String document) {
		try (ConfigurableApplicationContext refused = new SpringApplicationBuilder(ApiApplication.class)
				.web(WebApplicationType.NONE)
				.run("--mprelist.client-config.document=" + document,
						"--spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration",
						"--spring.flyway.enabled=false")) {
			throw new AssertionError("started with a document it should have refused: " + document);
		}
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
