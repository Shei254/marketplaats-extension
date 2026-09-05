package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import tools.jackson.databind.JsonNode;

/**
 * {@code GET /api/client-config} — what the extension should do differently from what it was built to do
 * (T27, #36; ADR-0013).
 *
 * <p>Over a real port, because what this route has to get right is the bytes: an extension reads this
 * document with a hand-written checker and drops anything it cannot recognise, so a field spelled one way
 * here and another way there is a config that silently does nothing. The document a suite builds by calling a
 * method could not see that.
 *
 * <p>The operator's document arrives as a dynamic property rather than through {@code application.yml},
 * which is the same trick {@link CrossOriginTest} uses on the allowed origins: the setting is what is under
 * test, so it has to be set per suite. What ships in the file is asserted separately, below.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(PostgresFromCompose.class)
class ClientConfigTest {

	private static final MintedTokens IDP = MintedTokens.servingItsKeys();

	/**
	 * One document holding every kind of thing an operator can override: a path, the CSRF block whole, and
	 * both of the client's pacing windows — the watched one and, since #147, the one inside a batch. Written
	 * as the JSON they would actually paste, rather than built up from objects, because the parse is half of
	 * what is being tested.
	 *
	 * <p>{@code rails} is not in it and cannot be. That block describes this API rather than the client, so it
	 * is stamped like {@code schemaVersion} and naming it is a document that fails to start
	 * ({@link ClientConfigWithoutADocumentTest}).
	 */
	private static final String DOCUMENT = """
			{"endpoints":{"deleteAd":"/seller/api/delete-ad-v2","listMyAds":"/my-account/sell/api/v2/listings"},
			 "csrf":{"mode":"meta","header":"x-mp-xsrf","name":"csrf-token"},
			 "pacing":{"minMs":60000,"maxMs":120000},
			 "bulkPacing":{"minMs":45000,"maxMs":90000}}
			""";

	@DynamicPropertySource
	static void anOperatorHasDeployedADocument(DynamicPropertyRegistry properties) {
		IDP.trustedAsTheIssuer(properties);
		properties.add("mprelist.client-config.document", () -> DOCUMENT);
	}

	@AfterAll
	static void stopServingKeys() {
		IDP.close();
	}

	@Test
	void whatAnOperatorDeployedIsWhatTheExtensionIsServed() {
		JsonNode document = Json.of(get());

		assertThat(document.get("endpoints").get("deleteAd").asString()).isEqualTo("/seller/api/delete-ad-v2");
		assertThat(document.get("csrf").get("mode").asString()).isEqualTo("meta");
		assertThat(document.get("csrf").get("header").asString()).isEqualTo("x-mp-xsrf");
		assertThat(document.get("csrf").get("name").asString()).isEqualTo("csrf-token");
		assertThat(document.get("pacing").get("minMs").asLong()).isEqualTo(60_000);
		assertThat(document.get("pacing").get("maxMs").asLong()).isEqualTo(120_000);
	}

	/**
	 * The batch window is a second window and not a replacement (#147, ADR-0025): the two gaps are watched
	 * differently — somebody sits through the one between two reposts they pressed and walks away from the ones
	 * inside a run they started — so an operator sets them independently and both are served.
	 */
	@Test
	void andTheGapInsideABatchIsAWindowOfItsOwnBesideIt() {
		JsonNode document = Json.of(get());

		assertThat(document.get("bulkPacing").get("minMs").asLong()).isEqualTo(45_000);
		assertThat(document.get("bulkPacing").get("maxMs").asLong()).isEqualTo(90_000);
		assertThat(document.get("pacing").get("minMs").asLong()).isEqualTo(60_000);
	}

	/**
	 * <strong>The rails are this API's own numbers, stamped rather than written</strong> (#147, ADR-0025) —
	 * the one block here that is not an override of a client default, and admitted as such. They gate nothing:
	 * the real refusal is {@code RATE_LIMITED} from the gate, and what the popup does with these is tell
	 * somebody that selecting twenty-five ads is about two hours before they commit to it.
	 *
	 * <p>Asserted against {@code application.yml} rather than against the literals, so this says "the document
	 * carries the rails this deployment enforces" rather than "the document carries 10 and an hour" — the
	 * second would pass on a deployment that had moved one and gone on quoting the other, which is the whole
	 * failure the block exists to prevent.
	 */
	@Test
	void andTheRailsServedAreTheOnesThisApiActuallyEnforces() {
		JsonNode rails = Json.of(get()).get("rails");

		assertThat(rails.get("burstLimit").asInt()).isEqualTo(Integer.parseInt(this.burstLimit));
		assertThat(rails.get("burstWindowMs").asLong())
				.isEqualTo(Duration.parse("PT" + this.burstWindow).toMillis());
	}

	/**
	 * The version says which shape this is, and it is this code's rather than the deployed document's — an
	 * operator who could set it could tell every installed client to read a shape nobody serves.
	 */
	@Test
	void andTheVersionIsStampedByTheApiRatherThanCarriedByTheDocument() {
		assertThat(Json.of(get()).get("schemaVersion").asInt()).isEqualTo(1);
	}

	/**
	 * The extension's CSRF modes are the client's own words, so they travel in the client's own case. Upper
	 * case here would be this API's vocabulary leaking into a document that is the extension's configuration
	 * — and the client would drop the whole block for a mode it does not recognise.
	 */
	@Test
	void aCsrfModeTravelsSpeltTheWayTheClientSpellsIt() {
		assertThat(get().body()).contains("\"mode\":\"meta\"").doesNotContain("META");
	}

	/**
	 * A field nobody overrode is absent rather than {@code null}. To a client the two have to mean the same
	 * thing — keep your default — so sending the longer one is a shape somebody could come to read a meaning
	 * into.
	 */
	@Test
	void andNothingIsSaidAboutWhatNobodyOverrode() {
		assertThat(Json.of(get()).has("dom")).isFalse();
		assertThat(get().body()).doesNotContain("null");
	}

	/**
	 * Closed like every other route, and this is the one that was expected to ask for an exception:
	 * {@code ResourceServerSecurity} names #36 as "the first that may want opening". It turned out not to.
	 * Everything this document configures happens on behalf of somebody who is signed in, so a caller who
	 * cannot hold a token has nothing to do with the answer.
	 */
	@Test
	void andItIsClosedLikeEveryOtherRoute() {
		HttpResponse<String> refused = Http.send(HttpRequest.newBuilder(uri()).timeout(TIMEOUT).GET().build());

		assertThat(refused.statusCode()).isEqualTo(401);
	}

	private HttpResponse<String> get() {
		return Http.send(HttpRequest.newBuilder(uri())
				.timeout(TIMEOUT)
				.header("Authorization", "Bearer " + IDP.token())
				.GET()
				.build());
	}

	private URI uri() {
		return URI.create("http://localhost:" + this.port + "/api/client-config");
	}

	@LocalServerPort
	private int port;

	/**
	 * The two rails as this deployment is configured, read from the same properties {@code SafetyPolicy}
	 * refuses on — which is what makes the assertion above about the pair rather than about two literals.
	 * Bound as text because the window is written the way a person writes one ({@code 1h}), and Spring's
	 * relaxed {@code Duration} binding is the thing under test's own conversion rather than this suite's.
	 */
	@Value("${mprelist.safety.burst-limit}")
	private String burstLimit;

	@Value("${mprelist.safety.burst-window}")
	private String burstWindow;

	private static final Duration TIMEOUT = Duration.ofSeconds(20);

}
