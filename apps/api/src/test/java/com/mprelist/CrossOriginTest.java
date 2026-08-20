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
 * Which browser origins this API answers, and how a preflight is treated (#41's bug, found by running it).
 *
 * <p>The failure this is written against was a real one: the popup called {@code GET /api/me} and Chrome
 * refused the answer before the extension saw it, reporting a missing {@code Access-Control-Allow-Origin}.
 * Nothing in this application was broken — every route answered — which is exactly why nothing in this suite
 * caught it. **A test over a real port that never sends an {@code Origin} header cannot see CORS at all.**
 *
 * <p>So these send one. The important half is the preflight: it carries no token by design, and a chain that
 * authenticated it first would refuse it with the contract's {@code 401} — leaving the browser to report a
 * missing header and the cause to look like anything but the filter order that produced it.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(PostgresFromCompose.class)
class CrossOriginTest {

	private static final MintedTokens IDP = MintedTokens.servingItsKeys();

	/** The origin this suite runs the application with, in the shape a real extension sends. */
	private static final String EXTENSION = "chrome-extension://dolloiambeojifmnofjchofbnepodiof";

	@DynamicPropertySource
	static void trustTheTokensThisSuiteMintsAndTheOriginItCallsFrom(DynamicPropertyRegistry properties) {
		IDP.trustedAsTheIssuer(properties);
		properties.add("mprelist.cors.allowed-origins", () -> EXTENSION);
	}

	@AfterAll
	static void stopServingKeys() {
		IDP.close();
	}

	/**
	 * The preflight, answered without a token — which is the whole of the bug that prompted this. A browser
	 * sends none on one, so an API that required it would refuse every call from every client it has.
	 */
	@Test
	void theBrowsersQuestionIsAnsweredBeforeAnybodyIsAskedForAToken() {
		HttpResponse<String> preflight = preflight(EXTENSION, "GET", "authorization");

		assertThat(preflight.statusCode()).isEqualTo(200);
		assertThat(header(preflight, "Access-Control-Allow-Origin")).isEqualTo(EXTENSION);
		assertThat(header(preflight, "Access-Control-Allow-Headers").toLowerCase()).contains("authorization");
	}

	/**
	 * And for the contract's POSTs too, which are preflighted for a second reason: a JSON content type is not
	 * a safelisted one either.
	 */
	@Test
	void andForAPostCarryingJson() {
		HttpResponse<String> preflight = preflight(EXTENSION, "POST", "authorization,content-type");

		assertThat(preflight.statusCode()).isEqualTo(200);
		assertThat(header(preflight, "Access-Control-Allow-Methods")).contains("POST");
		assertThat(header(preflight, "Access-Control-Allow-Headers").toLowerCase()).contains("content-type");
	}

	/** The answer itself carries the header too, or the browser withholds a body this API did return. */
	@Test
	void andTheAnswerToTheRealCallCarriesTheHeaderThatLetsTheClientReadIt() {
		HttpResponse<String> answered = get("/api/me", EXTENSION, IDP.token());

		assertThat(answered.statusCode()).isEqualTo(200);
		assertThat(header(answered, "Access-Control-Allow-Origin")).isEqualTo(EXTENSION);
		assertThat(Json.of(answered).get("tier").get("code").asString()).isNotBlank();
	}

	/**
	 * An origin nobody configured gets nothing — no header, and so no answer the page can read.
	 *
	 * <p>It is not the security boundary and is not asserted as one: the token is what decides who is
	 * answered, and a caller with one can have this body however they ask for it. What this stops is a page
	 * the user happens to be visiting reading their plan out of the API in the background.
	 */
	@Test
	void anOriginNobodyConfiguredIsNotAnsweredAtAll() {
		HttpResponse<String> preflight = preflight("https://somebody-elses-site.example", "GET", "authorization");

		assertThat(preflight.statusCode()).isEqualTo(403);
		assertThat(preflight.headers().firstValue("Access-Control-Allow-Origin")).isEmpty();
	}

	/**
	 * No credentials are allowed, ever. Nothing here is authenticated by a cookie — the token is the whole of
	 * the caller's identity and it arrives in a header the caller's own code sets — so allowing them would
	 * widen the grant to something no client of this API needs.
	 */
	@Test
	void andNoBrowserIsInvitedToSendCredentialsWithIt() {
		HttpResponse<String> preflight = preflight(EXTENSION, "GET", "authorization");

		assertThat(preflight.headers().firstValue("Access-Control-Allow-Credentials")).isEmpty();
	}

	/**
	 * The origin this application ships with is the one the realm registers for the same client, both spelled
	 * as a substitution of the same variable.
	 *
	 * <p>They are two files that have to agree about one id, and the failure of a disagreement is split
	 * between them: the token exchange goes through Keycloak's CORS and the API call goes through this, so a
	 * drift breaks one and not the other, and the symptom names whichever half was asked first.
	 */
	@Test
	void theOriginThisApiAllowsIsTheOneTheRealmRegistersForTheExtension() {
		String allowed = YamlSetting.inApplicationYaml("allowed-origins");
		JsonNode realm = Json.of(InfraFiles.textOf(InfraFiles.keycloakRealm()));

		assertThat(webOriginsOfTheExtensionClient(realm)).contains(allowed);
	}

	private static String webOriginsOfTheExtensionClient(JsonNode realm) {
		return realm.get("clients").valueStream()
				.filter(client -> "mprelist-extension".equals(client.path("clientId").asString()))
				.flatMap(client -> client.path("webOrigins").valueStream())
				.map(JsonNode::asString)
				.findFirst()
				.orElseThrow(() -> new IllegalStateException("the realm registers no web origin for the extension"));
	}

	private HttpResponse<String> preflight(String origin, String method, String headers) {
		return Http.send(request("/api/me", origin)
				.header("Access-Control-Request-Method", method)
				.header("Access-Control-Request-Headers", headers)
				.method("OPTIONS", HttpRequest.BodyPublishers.noBody())
				.build());
	}

	private HttpResponse<String> get(String path, String origin, String token) {
		return Http.send(request(path, origin).header("Authorization", "Bearer " + token).GET().build());
	}

	private HttpRequest.Builder request(String path, String origin) {
		return HttpRequest.newBuilder(URI.create("http://localhost:" + this.port + path))
				.timeout(Duration.ofSeconds(20))
				.header("Origin", origin);
	}

	private static String header(HttpResponse<String> response, String name) {
		return response.headers().firstValue(name)
				.orElseThrow(() -> new AssertionError("no " + name + " on " + response.statusCode()));
	}

	@LocalServerPort
	private int port;

}
