package com.mprelist;

import static com.mprelist.KeycloakFromCompose.API_CLIENT;
import static com.mprelist.KeycloakFromCompose.DASHBOARD_CLIENT;
import static com.mprelist.KeycloakFromCompose.DASHBOARD_REDIRECT_URI;
import static com.mprelist.KeycloakFromCompose.EXTENSION_CLIENT;
import static com.mprelist.KeycloakFromCompose.EXTENSION_ID;
import static com.mprelist.KeycloakFromCompose.EXTENSION_REDIRECT_URI;
import static com.mprelist.KeycloakFromCompose.WELL_FORMED_CHALLENGE;
import static com.mprelist.KeycloakFromCompose.redirectedError;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.util.Map;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;

/**
 * What {@code infra/keycloak/mprelist-realm.json} leaves behind, read back from a Keycloak that has just
 * imported it.
 *
 * <p>A realm file is configuration, so the temptation is to assert its text back to itself. Every test here
 * asks Keycloak instead — signs in, or is refused — because each promise the file makes is one a subtly
 * wrong key would keep in the file and lose in the server: a protocol mapper named right and configured
 * wrong imports without complaint, and so does an attribute Keycloak has since renamed.
 *
 * <p>This is the only place the realm is exercised. #19 validates tokens against test-minted ones and never
 * starts an IdP, so nothing else in the suite would notice this file breaking.
 */
class KeycloakRealmTest {

	private static KeycloakFromCompose keycloak;

	@BeforeAll
	static void startKeycloak() {
		keycloak = new KeycloakFromCompose();
	}

	@AfterAll
	static void stopKeycloak() {
		keycloak.close();
	}

	/**
	 * The realm name is the tail of the issuer, so it is the one value in the file that #19's
	 * {@code issuer-uri} and every token ever minted have to agree on.
	 */
	@Test
	void theRealmIsImportedUnderTheNameTheIssuerCarries() {
		assertThat(keycloak.signIn("dev", "dev").get("iss").asString())
				.isEqualTo(keycloak.baseUrl() + "/realms/mprelist");
	}

	/**
	 * The difference between offering PKCE and requiring it, which is the whole of what
	 * {@code pkce.code.challenge.method} buys. Keycloak's discovery document advertises {@code S256} to
	 * every realm whether or not any client requires one, so asserting that would prove nothing: only a
	 * refused request distinguishes the two.
	 */
	@Test
	void pkceIsRequiredOfTheExtensionRatherThanMerelyOfferedToIt() {
		HttpResponse<String> withoutAChallenge = keycloak.authorizationRequest(EXTENSION_CLIENT,
				EXTENSION_REDIRECT_URI, Map.of());

		assertThat(redirectedError(withoutAChallenge)).isEqualTo("invalid_request");
	}

	/**
	 * And S256 specifically: {@code plain} sends the verifier itself, which is a code challenge that is not
	 * a challenge. The challenge is well formed on purpose — Keycloak refuses a short one for being short,
	 * so a sloppier one would leave this green against a realm that requires nothing at all.
	 */
	@Test
	void andPlainIsNotGoodEnoughForIt() {
		HttpResponse<String> plain = keycloak.authorizationRequest(EXTENSION_CLIENT, EXTENSION_REDIRECT_URI,
				Map.of("code_challenge", WELL_FORMED_CHALLENGE, "code_challenge_method", "plain"));

		assertThat(redirectedError(plain)).isEqualTo("invalid_request");
	}

	/**
	 * The dashboard is the second client that holds a user's session, and it is a browser SPA — the case
	 * PKCE was written for. Refusing this request is also the only proof that the client exists at all and
	 * that its redirect URI is the one #42 will be served from.
	 */
	@Test
	void andTheDashboardIsHeldToTheSameRequirement() {
		HttpResponse<String> withoutAChallenge = keycloak.authorizationRequest(DASHBOARD_CLIENT,
				DASHBOARD_REDIRECT_URI, Map.of());

		assertThat(redirectedError(withoutAChallenge)).isEqualTo("invalid_request");
	}

	/**
	 * ADR-0010 chose Authorization Code + PKCE. A public client that also accepts a password grant offers a
	 * second, weaker way in that neither client would ever use — and one that hands the user's Keycloak
	 * password to whatever asks for it.
	 */
	@Test
	void neitherClientAcceptsAPasswordGrant() {
		assertThat(passwordGrantFor(EXTENSION_CLIENT)).isEqualTo("unauthorized_client");
		assertThat(passwordGrantFor(DASHBOARD_CLIENT)).isEqualTo("unauthorized_client");
	}

	/**
	 * The extension id is not known to this repository — ADR-0010 leaves it to #13 — so the realm takes it
	 * from {@code MPRELIST_EXTENSION_ID} at import time. This is that substitution working from both sides:
	 * the id the import was given is accepted, and a neighbouring extension's is not.
	 *
	 * <p>Keycloak refuses an unregistered redirect URI with a page rather than a redirect, which is the
	 * point of the check — it will not bounce a browser to a URI it does not already trust.
	 */
	@Test
	void theExtensionRedirectUriIsBuiltFromTheExtensionIdTheImportWasGiven() {
		HttpResponse<String> somebodyElsesExtension = keycloak.authorizationRequest(EXTENSION_CLIENT,
				"https://ponmlkjihgfedcbaponmlkjihgfedcba.chromiumapp.org/", pkce());
		assertThat(somebodyElsesExtension.statusCode()).isEqualTo(400);
		assertThat(somebodyElsesExtension.headers().firstValue("location")).isEmpty();

		HttpResponse<String> ours = keycloak.authorizationRequest(EXTENSION_CLIENT, EXTENSION_REDIRECT_URI, pkce());
		assertThat(ours.statusCode()).isEqualTo(200);
	}

	/**
	 * The origin the MV3 service worker's own fetch carries, which is not the redirect URI's. Keycloak
	 * answers a preflight from anywhere, so only the token request itself shows whether the origin is
	 * registered: an unregistered one is refused outright, a registered one is answered — here with a 400,
	 * because the code below is nonsense and the audience of this test is the CORS verdict, not the code.
	 */
	@Test
	void andTheWebOriginIsTheExtensionItself() {
		HttpResponse<String> ours = exchangeFrom("chrome-extension://" + EXTENSION_ID);
		assertThat(ours.headers().firstValue("access-control-allow-origin"))
				.hasValue("chrome-extension://" + EXTENSION_ID);

		assertThat(exchangeFrom("https://evil.example").statusCode()).isEqualTo(403);
	}

	/**
	 * The client the API is, rather than the client it is named: it registers no redirect URI, so no
	 * browser login can be started as it and it can only ever be the audience of somebody else's token.
	 */
	@Test
	void noBrowserLoginCanBeStartedAsTheApiClient() {
		HttpResponse<String> asTheApi = keycloak.authorizationRequest(API_CLIENT, DASHBOARD_REDIRECT_URI, pkce());

		assertThat(asTheApi.statusCode()).isEqualTo(400);
		assertThat(asTheApi.headers().firstValue("location")).isEmpty();
	}

	/**
	 * Without the audience mapper a token minted for the extension names {@code account}, and the resource
	 * server (#19) has nothing to check but the issuer — which every client in the realm shares.
	 */
	@Test
	void aTokenTheExtensionMintsNamesTheApiAsItsAudience() {
		assertThat(keycloak.signIn("dev", "dev").get("aud").asString()).isEqualTo(API_CLIENT);
	}

	/** #27 guards the admin module on this role, so a token has to be able to carry it. */
	@Test
	void andCarriesTheAdminRoleForAnOperatorWhoHasIt() {
		JsonNode claims = keycloak.signIn("dev-admin", "dev-admin");

		assertThat(claims.get("preferred_username").asString()).isEqualTo("dev-admin");
		assertThat(claims.get("realm_access").get("roles").valueStream().map(JsonNode::asString)).contains("ADMIN");
	}

	/**
	 * And the shape of an ordinary user's token, which is the case a role check has to survive: Keycloak
	 * leaves {@code realm_access} out altogether rather than sending an empty list, so #27 reading
	 * {@code realm_access.roles} straight through would fail on every user who is not an operator.
	 */
	@Test
	void whileAnOrdinaryUserCarriesNoRealmAccessAtAll() {
		assertThat(keycloak.signIn("dev", "dev").get("realm_access")).isNull();
	}

	/**
	 * Everything above is proven on a container this suite starts, which says nothing about the local stack
	 * ever reading the file. These two lines of compose are what connects them, and neither is inferable
	 * from a green suite.
	 *
	 * <p>The flag is matched inside the command rather than anywhere in the file: the comment above it
	 * explains {@code --import-realm} by name, and an assertion on the bare word passes on the comment
	 * alone — which it did, until deleting the flag was tried and changed nothing.
	 */
	@Test
	void andTheLocalStackImportsTheRealmThisSuiteProves() {
		String compose = ComposeFile.text();

		assertThat(compose).contains("command: [\"start-dev\", \"--import-realm\"]");
		assertThat(compose).contains("./keycloak:/opt/keycloak/data/import");
	}

	private static Map<String, String> pkce() {
		return Map.of("code_challenge", WELL_FORMED_CHALLENGE, "code_challenge_method", "S256");
	}

	private static String passwordGrantFor(String clientId) {
		return KeycloakFromCompose.errorOf(keycloak.tokenRequest(
				Map.of("grant_type", "password", "client_id", clientId, "username", "dev", "password", "dev"),
				Map.of()));
	}

	/** A code exchange that cannot succeed, sent only to see whether the origin it comes from is allowed. */
	private static HttpResponse<String> exchangeFrom(String origin) {
		return keycloak.tokenRequest(
				Map.of("grant_type", "authorization_code", "client_id", EXTENSION_CLIENT, "code", "not-a-code",
						"redirect_uri", EXTENSION_REDIRECT_URI, "code_verifier", WELL_FORMED_CHALLENGE),
				Map.of("Origin", origin));
	}

}
