package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Arrays;

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
 * <p><strong>The empty document is an answer, not an absence.</strong> It means "the defaults you shipped
 * with are correct" — so there is no {@code 404} and no {@code 503} here, and a client that got one would have
 * to decide whether to keep waiting for a document that is never coming.
 *
 * <p>Since #147 that answer carries one block an operator did not write: {@code rails}, which states what this
 * API refuses on rather than patching anything the client shipped with (ADR-0025). Everything that <em>is</em>
 * a patch is still absent, which is what the first test below says in both directions.
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
		assertThat(document.has("bulkPacing")).isFalse();
	}

	/**
	 * But the rails are there, because they are not an override of anything (#147, ADR-0025). Every other
	 * field says "do something other than what you were built to do"; this one says what this API will
	 * authorize in an hour, which the popup turns into "about two hours" beside a selection of twenty-five.
	 *
	 * <p>Stamped rather than written for {@code schemaVersion}'s reason read the other way round: an operator
	 * who had to re-paste a JSON document after dropping the burst limit at 3am would eventually not, and
	 * every popup would go on quoting a duration this API had stopped honouring — which is the one failure
	 * serving the block was supposed to prevent.
	 */
	@Test
	void butTheRailsAreServedByADeploymentThatOverrodeNothing() {
		JsonNode rails = Json.of(get()).get("rails");

		assertThat(rails).isNotNull();
		// Zero is the shipped value since the burst cap was switched off; it is still stamped, never absent.
		assertThat(rails.get("burstLimit").asInt()).isNotNegative();
		assertThat(rails.get("burstWindowMs").asLong()).isPositive();
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
	 * And a document naming the rails, which is the same rule as {@code schemaVersion} above: both describe
	 * what this code serves rather than what an operator wants served, so both are stamped and neither is
	 * writable. An operator who could set this one could tell every popup a duration this API does not honour.
	 */
	@Test
	void andSoDoesADocumentTryingToWriteTheRails() {
		assertThatThrownBy(() -> startWith("{\"rails\":{\"burstLimit\":99,\"burstWindowMs\":1000}}"))
				.hasStackTraceContaining("mprelist.client-config.document")
				.hasStackTraceContaining("rails");
	}

	/**
	 * A batch window under the alarm clamp, which is the one refusal here that is a property of the mechanism
	 * rather than a matter of taste. {@code chrome.alarms} advances a batch and MV3 clamps it at about 30
	 * seconds, so a window below that is not a jittered gap — it is a 30-second metronome, which is exactly
	 * the rhythm ADR-0008 exists to avoid. <strong>And the clamp is invisible in development</strong>, because
	 * unpacked extensions are not clamped: an operator who set five seconds would watch it work locally and
	 * ship a metronome to everybody else, so startup is the only moment anybody can be told.
	 */
	@Test
	void andSoDoesABatchWindowUnderTheAlarmClampThatAdvancesIt() {
		assertThatThrownBy(() -> startWith("{\"bulkPacing\":{\"minMs\":5000,\"maxMs\":60000}}"))
				.hasStackTraceContaining("mprelist.client-config.document")
				.hasStackTraceContaining("chrome.alarms");
	}

	/** And one that runs backwards, which is a window no gap can be drawn from — batch or otherwise. */
	@Test
	void andSoDoesABatchWindowThatRunsBackwards() {
		assertThatThrownBy(() -> startWith("{\"bulkPacing\":{\"minMs\":90000,\"maxMs\":45000}}"))
				.hasStackTraceContaining("bulkPacing")
				.hasStackTraceContaining("run forwards");
	}

	/**
	 * And one so wide that the run ADR-0025 sized in hours becomes one sized in days. The ceiling is the same
	 * five minutes the watched window has and the reason is a different one: that window has to be waited out
	 * inside a service worker Chrome kills, and this one is waited out by an alarm — so what bounds it is the
	 * design rather than the runtime.
	 */
	@Test
	void andSoDoesOneThatWouldTurnABatchIntoADaysWork() {
		assertThatThrownBy(() -> startWith("{\"bulkPacing\":{\"minMs\":30000,\"maxMs\":3600000}}"))
				.hasStackTraceContaining("bulkPacing")
				.hasStackTraceContaining("ADR-0025");
	}

	/**
	 * The pacing window has settings of its own beside the document, because it is the one field of it
	 * anybody tunes — and the same rule applies to them: a deployment that says something this API cannot
	 * read is told at startup rather than serving a window nobody chose.
	 *
	 * <p>Half a window first, which is how it will actually happen: somebody changes the floor and does not
	 * notice there is a ceiling. There is no half of a window to invent — the other end could only be the
	 * one built into the extension, which is not a number this API knows.
	 */
	@Test
	void andSoDoesHalfOfAPacingWindow() {
		assertThatThrownBy(() -> startWithSettings("--mprelist.client-config.pacing.min-ms=10000"))
				.hasStackTraceContaining("mprelist.client-config.pacing")
				.hasStackTraceContaining("both ends");
	}

	/** And one that runs backwards, which is a window no gap can be drawn from. */
	@Test
	void andSoDoesAPacingWindowThatRunsBackwards() {
		assertThatThrownBy(() -> startWithSettings("--mprelist.client-config.pacing.min-ms=30000",
				"--mprelist.client-config.pacing.max-ms=10000"))
				.hasStackTraceContaining("mprelist.client-config.pacing")
				.hasStackTraceContaining("run forwards");
	}

	/**
	 * And one longer than the service worker that has to wait it out. Chrome kills an idle MV3 worker after
	 * about five minutes, so a longer window is a relist that never starts — and the client drops the whole
	 * document rather than half-applying it, which makes this the only moment an operator can be told.
	 */
	@Test
	void andSoDoesAPacingWindowLongerThanTheWorkerThatWaitsItOut() {
		assertThatThrownBy(() -> startWithSettings("--mprelist.client-config.pacing.min-ms=0",
				"--mprelist.client-config.pacing.max-ms=600000"))
				.hasStackTraceContaining("mprelist.client-config.pacing")
				.hasStackTraceContaining("service worker");
	}

	/** And a value that is not a number of milliseconds at all — {@code 10s} is the obvious way to write it. */
	@Test
	void andSoDoesADurationWhereMillisecondsWereAskedFor() {
		assertThatThrownBy(() -> startWithSettings("--mprelist.client-config.pacing.min-ms=10s",
				"--mprelist.client-config.pacing.max-ms=30s"))
				.hasStackTraceContaining("mprelist.client-config.pacing.min-ms")
				.hasStackTraceContaining("milliseconds");
	}

	/**
	 * And a window set in both places at once. Preferring one silently would leave a deployment where the
	 * JSON says one thing, the environment says another, and which wins is whichever way this happened to be
	 * written — so it is a mistake to report rather than a conflict to resolve.
	 */
	@Test
	void andSoDoesAWindowSetTwice() {
		assertThatThrownBy(() -> startWithSettings("--mprelist.client-config.document={\"pacing\":{\"minMs\":1,\"maxMs\":2}}",
				"--mprelist.client-config.pacing.min-ms=10000",
				"--mprelist.client-config.pacing.max-ms=30000"))
				.hasStackTraceContaining("set twice");
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
		startWithSettings("--mprelist.client-config.document=" + document);
	}

	/**
	 * The same, for the settings that are not the document: the pacing window is a pair of properties beside
	 * it, and half of one is as refusable as a misspelt field.
	 */
	private static void startWithSettings(String... settings) {
		String[] arguments = Arrays.copyOf(settings, settings.length + 2);
		arguments[settings.length] = "--spring.autoconfigure.exclude="
				+ "org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration";
		arguments[settings.length + 1] = "--spring.flyway.enabled=false";
		try (ConfigurableApplicationContext refused = new SpringApplicationBuilder(ApiApplication.class)
				.web(WebApplicationType.NONE)
				.run(arguments)) {
			throw new AssertionError("started with settings it should have refused: " + String.join(" ", settings));
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
