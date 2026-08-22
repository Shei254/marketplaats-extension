package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.Base64;

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

	/** And {@code apps/web}'s, which its admin corner calls this API from (T54, #85). */
	private static final String WEB = "http://localhost:5173";

	@DynamicPropertySource
	static void trustTheTokensThisSuiteMintsAndTheOriginsItCallsFrom(DynamicPropertyRegistry properties) {
		IDP.trustedAsTheIssuer(properties);
		properties.add("mprelist.cors.allowed-origins", () -> EXTENSION + "," + WEB);
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

	/**
	 * And for the header every client now names itself with (T43, #52). This is the one that fails most
	 * confusingly if it is forgotten: a header the preflight does not allow is not dropped from the request,
	 * it makes the browser abandon the <em>whole call</em> — so every request would break in order to carry a
	 * diagnostic nothing depends on.
	 */
	@Test
	void andForTheHeaderTheClientNamesItselfWith() {
		HttpResponse<String> preflight = preflight(EXTENSION, "GET", "authorization,x-mprelist-client");

		assertThat(preflight.statusCode()).isEqualTo(200);
		assertThat(header(preflight, "Access-Control-Allow-Headers").toLowerCase()).contains("x-mprelist-client");
	}

	/**
	 * And for the {@code PUT}s the admin catalog saves with (T53, #84).
	 *
	 * <p>A method a preflight does not allow makes the browser abandon the call, exactly as an unallowed
	 * header does — so an operator's every save would fail with nothing in this application's log to show for
	 * it. This is one half of a bug that shipped: T53 added the routes and T54 the screen, and neither added
	 * the method or the origin here.
	 */
	@Test
	void andForThePutsTheAdminCatalogSavesWith() {
		HttpResponse<String> preflight = preflight(WEB, "PUT", "authorization,content-type");

		assertThat(preflight.statusCode()).isEqualTo(200);
		assertThat(header(preflight, "Access-Control-Allow-Methods")).contains("PUT");
	}

	/**
	 * And {@code apps/web} is answered at all, which is the other half of that bug.
	 *
	 * <p>The extension had been the only client since #41, so every assertion above was about one origin and
	 * a second could be forgotten without any of them noticing — which is what happened.
	 */
	@Test
	void andTheSiteTheAdminCornerIsServedFromIsAnsweredToo() {
		HttpResponse<String> preflight = preflight(WEB, "GET", "authorization");

		assertThat(preflight.statusCode()).isEqualTo(200);
		assertThat(header(preflight, "Access-Control-Allow-Origin")).isEqualTo(WEB);
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
	 *
	 * <p>They spell it differently on purpose — the realm substitutes from the environment because it is
	 * imported once, and this application defaults to the id because it is re-read on every start — so what
	 * is asserted is the shape of each rather than one string equal to the other.
	 */
	@Test
	void andTheRealmRegistersThatSameOriginAsTheExtensionsWebOrigin() {
		String key = Json.of(InfraFiles.textOf(InfraFiles.extensionManifest())).get("key").asString();
		JsonNode realm = Json.of(InfraFiles.textOf(InfraFiles.keycloakRealm()));

		// The realm substitutes rather than defaulting, so what is compared is the id both resolve to — the
		// file cannot be read with the variable already applied, and the point is that they name one id.
		assertThat(webOriginsOfTheExtensionClient(realm))
				.isEqualTo("chrome-extension://${MPRELIST_EXTENSION_ID:unset-extension-id}");
		assertThat(YamlSetting.inApplicationYaml("allowed-origins")).contains(extensionIdFrom(key));
	}

	/**
	 * And the site's origin is the one it is <em>served</em> from, which this application already names once:
	 * {@code mprelist.web.base-url} is what a Checkout session sends a browser back to (#29) and what the
	 * Customer Portal returns it to (#31).
	 *
	 * <p>Two settings rather than one because they are different things — CORS wants an origin and that one is
	 * a URL — and held together here so neither can move alone. A deployment that changed the base URL and not
	 * this list would have a working payment flow and an admin corner that no browser will call, which is a
	 * pair of symptoms nobody would connect.
	 */
	@Test
	void andTheSiteOriginItAllowsIsTheOneItSendsBrowsersTo() {
		String baseUrl = YamlSetting.inApplicationYaml("base-url");

		assertThat(YamlSetting.inApplicationYaml("allowed-origins")).contains(originOf(baseUrl));
	}

	/**
	 * And the realm registers that same origin for the client the admin corner signs in with, which is the
	 * {@code mprelist-dashboard} the realm has defined since #15.
	 *
	 * <p>The same split as the extension's above, and the same failure of a disagreement: the sign-in goes
	 * through Keycloak's CORS and the API call through this one, so a drift breaks one and not the other.
	 */
	@Test
	void andTheRealmRegistersItForTheClientTheAdminCornerSignsInWith() {
		JsonNode realm = Json.of(InfraFiles.textOf(InfraFiles.keycloakRealm()));

		assertThat(webOriginsOf(realm, "mprelist-dashboard"))
				.isEqualTo(originOf(YamlSetting.inApplicationYaml("base-url")));
	}

	/** The scheme, host and port of a URL, which is what an `Origin` header carries and a path is not. */
	private static String originOf(String url) {
		return URI.create(url).resolve("/").toString().replaceAll("/$", "");
	}

	/**
	 * The origin this application ships with names the extension's **actual** id — derived here from the
	 * {@code key} the manifest pins it with, exactly as {@code npm run extension-id} derives it.
	 *
	 * <p>This is what makes a literal safe to write in {@code application.yml} at all. The setting defaults
	 * to the id rather than to an environment variable because the variant that required one was tried
	 * first, and every developer met the same failure: a browser refusing an answer, naming nothing about
	 * this application, with the fix living in a shell they had already opened. A value that is wrong here
	 * costs a restart; the realm file, which imports once, keeps the substitution because a value that is
	 * wrong *there* costs a {@code down -v}.
	 *
	 * <p>Chrome's own derivation: SHA-256 of the decoded key, the first sixteen bytes, each nibble as a
	 * letter {@code a}–{@code p}. Pinned against the key rather than against a second copy of the id.
	 */
	@Test
	void theOriginThisApiAllowsIsDerivedFromTheKeyTheExtensionIsPinnedBy() {
		String key = Json.of(InfraFiles.textOf(InfraFiles.extensionManifest())).get("key").asString();

		// The list now has a second entry (T54, #85), so this is what it starts with rather than all of it.
		assertThat(YamlSetting.inApplicationYaml("allowed-origins"))
				.startsWith("chrome-extension://${MPRELIST_EXTENSION_ID:" + extensionIdFrom(key) + "}");
	}

	private static String extensionIdFrom(String base64Key) {
		byte[] digest;
		try {
			digest = MessageDigest.getInstance("SHA-256").digest(Base64.getDecoder().decode(base64Key));
		}
		catch (NoSuchAlgorithmException impossible) {
			throw new IllegalStateException("SHA-256 is not optional in a JDK", impossible);
		}

		StringBuilder id = new StringBuilder(32);
		for (int byteIndex = 0; byteIndex < 16; byteIndex++) {
			id.append((char) ('a' + ((digest[byteIndex] >> 4) & 0xF)));
			id.append((char) ('a' + (digest[byteIndex] & 0xF)));
		}
		return id.toString();
	}

	private static String webOriginsOfTheExtensionClient(JsonNode realm) {
		return webOriginsOf(realm, "mprelist-extension");
	}

	private static String webOriginsOf(JsonNode realm, String clientId) {
		return realm.get("clients").valueStream()
				.filter(client -> clientId.equals(client.path("clientId").asString()))
				.flatMap(client -> client.path("webOrigins").valueStream())
				.map(JsonNode::asString)
				.findFirst()
				.orElseThrow(() -> new IllegalStateException("the realm registers no web origin for " + clientId));
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
