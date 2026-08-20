package com.mprelist;

import static com.mprelist.KeycloakFromCompose.API_CLIENT;
import static com.mprelist.KeycloakFromCompose.DASHBOARD_CLIENT;
import static com.mprelist.KeycloakFromCompose.DASHBOARD_REDIRECT_URI;
import static com.mprelist.KeycloakFromCompose.EXTENSION_CLIENT;
import static com.mprelist.KeycloakFromCompose.EXTENSION_ID;
import static com.mprelist.KeycloakFromCompose.EXTENSION_REDIRECT_URI;
import static com.mprelist.KeycloakFromCompose.WELL_FORMED_CHALLENGE;
import static com.mprelist.KeycloakFromCompose.pkce;
import static com.mprelist.KeycloakFromCompose.redirectedError;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

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
 * <p>This and {@link KeycloakRealmWithoutAnExtensionIdTest} — the same realm imported with no
 * {@code MPRELIST_EXTENSION_ID} — are the only places the realm is exercised. #19 validates tokens against
 * test-minted ones and never starts an IdP, so nothing else in the suite would notice this file breaking.
 */
class KeycloakRealmTest {

	private static KeycloakFromCompose keycloak;

	@BeforeAll
	static void startKeycloak() {
		keycloak = KeycloakFromCompose.withTheExtensionIdSet();
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
	 * And registered <em>exactly</em>, not as a prefix. ADR-0010: "Do not solve this with a wildcard redirect
	 * URI in Keycloak — it works, but an open redirect target on a public OAuth client is not something to
	 * carry into production."
	 *
	 * <p>A trailing {@code /*} is host-scoped, so it is not an open redirect in the usual sense and the test
	 * above passes either way. It is still worth refusing: {@code launchWebAuthFlow} returns to
	 * {@code chrome.identity.getRedirectURL()} and nothing else, so every path the wildcard additionally
	 * admits is one no honest flow uses — it widens where an intercepted code can be delivered and buys
	 * nothing back. This is the assertion that tells the two apart.
	 */
	@Test
	void andRegisteredExactlyRatherThanAsAPrefixOverEverythingBeneathIt() {
		HttpResponse<String> aPathBeneathOurs = keycloak.authorizationRequest(EXTENSION_CLIENT,
				EXTENSION_REDIRECT_URI + "somewhere-else", pkce());

		assertThat(aPathBeneathOurs.statusCode()).isEqualTo(400);
		assertThat(aPathBeneathOurs.headers().firstValue("location")).isEmpty();
	}

	/**
	 * The dashboard is a public client on the same reasoning, so it is held to the same shape. #42 owns which
	 * URI it is — a router that needs {@code /callback} changes this line — but not whether it is exact.
	 */
	@Test
	void asIsTheDashboardsOwn() {
		HttpResponse<String> aRouteBeneathIt = keycloak.authorizationRequest(DASHBOARD_CLIENT,
				DASHBOARD_REDIRECT_URI + "some-route", pkce());

		assertThat(aRouteBeneathIt.statusCode()).isEqualTo(400);
		assertThat(aRouteBeneathIt.headers().firstValue("location")).isEmpty();
	}

	/**
	 * And a logout returns to those same URIs and no others. {@code post.logout.redirect.uris} is {@code "+"}
	 * — Keycloak's "whatever {@code redirectUris} holds" — rather than the URI spelled a second time, so the
	 * sign-in and sign-out sides cannot drift apart and neither can regrow a wildcard the other dropped.
	 */
	@Test
	void andALogoutReturnsOnlyWhereASignInWouldHave() {
		HttpResponse<String> elsewhere = keycloak.logout(freshIdToken(), EXTENSION_REDIRECT_URI + "somewhere-else");
		assertThat(elsewhere.statusCode()).isEqualTo(400);

		HttpResponse<String> back = keycloak.logout(freshIdToken(), EXTENSION_REDIRECT_URI);
		assertThat(back.statusCode()).isEqualTo(302);
		assertThat(back.headers().firstValue("location")).hasValue(EXTENSION_REDIRECT_URI);
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
		assertThat(audiencesOf(keycloak.signIn("dev", "dev"))).contains(API_CLIENT);
	}

	/**
	 * And names it <em>among others</em>, which is the shape #19 has to read. Keycloak writes {@code aud} as
	 * a bare string when a token has one audience and as an array when it has more, and which of the two
	 * arrives depends on the roles the user holds — {@code default-roles-mprelist} carries {@code account}'s
	 * client roles, so it adds {@code account} beside {@code mprelist-api}.
	 *
	 * <p>This is asserted because the cheap reading of the test above is that {@code aud} is a string. It is
	 * a string there only because an <em>imported</em> user is not granted the realm's default roles, which
	 * users made through the admin console or a registration form are: a resource server that compares
	 * {@code aud} as one string passes against {@code dev} and fails against the first real user.
	 */
	@Test
	void andIsAListAsSoonAsItsUserHoldsTheRealmsDefaultRoles() {
		assertThat(audiencesOf(keycloak.signIn("dev-admin", "dev-admin"))).contains(API_CLIENT, "account");
	}

	/**
	 * #27 guards the admin module on this role, so a token has to be able to carry it — and the role is also
	 * the only thing in the token that now says <em>whose</em> it is, `dev-admin` being the one user who holds
	 * it. The username used to be asserted here; the test below is why it is not.
	 */
	@Test
	void andCarriesTheAdminRoleForAnOperatorWhoHasIt() {
		JsonNode claims = keycloak.signIn("dev-admin", "dev-admin");

		assertThat(claims.get("realm_access").get("roles").valueStream().map(JsonNode::asString)).contains("ADMIN");
	}

	/**
	 * ADR-0001/0005 draw the boundary at not sending personal data to our backend, and #108 found it crossed:
	 * a token minted here carried the user's real address, their name, and their username, in a bearer that
	 * travels to our API, sits in {@code chrome.storage.local}, and appears in full in any log line that ever
	 * prints one. Nothing read it — {@code identity} takes {@code sub} and nothing else — which is precisely
	 * why it went unnoticed for as long as it did.
	 *
	 * <p><strong>Asking for a narrow scope is not what decides this.</strong> The extension requests
	 * {@code scope=openid} and nothing else (T23), and that was believed to be the whole answer; it is not.
	 * Keycloak's <em>default client scopes</em> are added to every token whatever the authorization request
	 * asks for, and {@code profile} and {@code email} are attached to every client a realm creates unless the
	 * client names its own. So this is a property of the realm file and can only be asserted here — the
	 * extension's own test can see the request it sends, never the token that comes back.
	 *
	 * <p>Asserted against the <em>values</em> the realm records for that user rather than against a list of
	 * claim names: {@code email} and {@code preferred_username} are the two #108 reported, and a claim under
	 * some name nobody here thought to forbid is exactly the regression a name list would let through.
	 */
	@Test
	void andCarriesNothingAboutTheUserBeyondTheIdOurApiIdentifiesThemBy() {
		JsonNode claims = keycloak.signIn("dev", "dev");

		assertThat(claims.get("sub").asString()).isNotBlank();
		assertThat(claims.toString()).doesNotContain(whatTheRealmKnowsAbout("dev"));
	}

	/**
	 * And the dashboard's tokens are held to the same thing. It is the second client that holds a user's
	 * session, its tokens name the same {@code aud} and are read by the same API, and it inherits the same
	 * realm defaults — so leaving it out would fix the boundary for one caller and leave it crossed for the
	 * other, in the client whose admin screens (T54) are the ones an operator signs into.
	 */
	@Test
	void asIsWhatTheDashboardMints() {
		JsonNode claims = keycloak.signIn(DASHBOARD_CLIENT, DASHBOARD_REDIRECT_URI, "dev", "dev");

		assertThat(claims.get("sub").asString()).isNotBlank();
		assertThat(claims.toString()).doesNotContain(whatTheRealmKnowsAbout("dev"));
	}

	/**
	 * And it cannot simply be asked for back. Naming the default scopes settles what arrives unasked; the
	 * <em>optional</em> ones are what a client may add to a request, and a realm's own defaults include
	 * {@code address} and {@code phone} — which map straight off the user profile — and
	 * {@code microprofile-jwt}, which carries the username as {@code upn}. Neither client asks for any of
	 * them, so assigning none costs nothing and means the boundary holds against the request rather than
	 * against the code that happens to make it today.
	 *
	 * <p>Keycloak refuses an unassigned scope through the redirect URI, which is also what proves the empty
	 * list imported at all: leaving {@code optionalClientScopes} out entirely assigns the realm's own, and
	 * this same request would be answered with a login page.
	 */
	@Test
	void andNoRequestCanAddAScopeThatWouldPutItBack() {
		Map<String, String> askingForMore = new LinkedHashMap<>(pkce());
		askingForMore.put("scope", "openid microprofile-jwt");

		HttpResponse<String> asked = keycloak.authorizationRequest(EXTENSION_CLIENT, EXTENSION_REDIRECT_URI,
				askingForMore);

		assertThat(redirectedError(asked)).isEqualTo("invalid_scope");
	}

	/**
	 * And the shape a role check has to survive: a user holding <em>no realm role at all</em> gets no
	 * {@code realm_access} claim rather than an empty one, so #27 reading {@code realm_access.roles} straight
	 * through throws where it meant to deny.
	 *
	 * <p>{@code dev} is that user because an imported user is not granted {@code default-roles-mprelist} —
	 * not because ordinary users lack roles; made any other way they hold it, and {@code dev-admin} above is
	 * given it on purpose so that both shapes are covered. So this is an edge #27 must survive rather than
	 * the case it will usually meet, which is the harder thing to remember and the reason it is written down
	 * here rather than assumed.
	 */
	@Test
	void whileAUserHoldingNoRealmRoleAtAllCarriesNoRealmAccess() {
		assertThat(keycloak.signIn("dev", "dev").get("realm_access")).isNull();
	}

	/**
	 * ADR-0010 has the extension hold "a rotating refresh token", and rotation is a realm setting Keycloak
	 * leaves <em>off</em>: unset, every refresh token a session ever issued stays valid beside the one that
	 * replaced it, so a copy read out of extension storage outlives the refresh that should have retired it.
	 * The only proof is spending the same token twice.
	 */
	@Test
	void aRefreshTokenIsSpentByTheRefreshThatUsesIt() {
		String issued = keycloak.tokensFor("dev", "dev").get("refresh_token").asString();

		assertThat(keycloak.refresh(issued).statusCode()).isEqualTo(200);
		assertThat(KeycloakFromCompose.errorOf(keycloak.refresh(issued))).isEqualTo("invalid_grant");
	}

	/**
	 * And lives long enough for the refresh to be the on-demand one ADR-0010 asks for. Keycloak's default
	 * session idle timeout is thirty minutes, which an MV3 service worker exceeds by sleeping between one
	 * relist and the next: the refresh then fails, and the extension has to re-run {@code launchWebAuthFlow}
	 * — interactively, since it needs a user gesture. That is the failure "on demand at call time, never on
	 * a timer" was chosen to avoid, and defaulting the timeout reintroduces it.
	 */
	@Test
	void andOutlivesAnMv3WorkerThatSleptBetweenCalls() {
		JsonNode refreshToken = KeycloakFromCompose
				.claimsOf(keycloak.tokensFor("dev", "dev").get("refresh_token").asString());

		assertThat(lifespanOf(refreshToken)).isEqualTo(Duration.ofDays(30));
	}

	/**
	 * While the access token it buys stays short: ADR-0010 accepted that "revocation is only as fast as the
	 * access-token TTL", so how long that is, is the size of the hole the ADR agreed to live with.
	 *
	 * <p>Unlike the two above, this one does not fail if the realm's {@code accessTokenLifespan} is deleted —
	 * five minutes is also Keycloak's default, so there is no mutation to catch. It is kept because
	 * {@link ComposeFile} takes the image tag from compose: the day that default moves under an upgrade, this
	 * runs on the new version and reports it. The subject is the revocation window, not the line.
	 */
	@Test
	void whileTheAccessTokenStaysAsShortLivedAsRevocationNeeds() {
		assertThat(lifespanOf(keycloak.signIn("dev", "dev"))).isEqualTo(Duration.ofMinutes(5));
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

	/**
	 * And passes {@code MPRELIST_EXTENSION_ID} through <em>without a value of its own</em>, which is what
	 * lets {@link KeycloakRealmWithoutAnExtensionIdTest}'s fallback ever be reached in the real stack: an
	 * unset shell has to arrive at the import as an unset variable. Giving it {@code ""} here would define it
	 * empty, the realm file's {@code ${...:default}} would not apply, and the client would register a
	 * redirect URI with no host — which imports without complaint and refuses every sign-in.
	 *
	 * <p>Asserted on the compose text because no container this suite starts uses compose's environment.
	 */
	@Test
	void andPassesTheExtensionIdThroughWithoutGivingItAValue() {
		assertThat(ComposeFile.text()).containsPattern("\\n\\s+MPRELIST_EXTENSION_ID:[ \\t]*\\n");
	}

	/**
	 * Everything the realm file records about a user besides their id, as the strings a token carrying any of
	 * it would contain. Read out of the file rather than spelled here: an address changed there would
	 * otherwise leave the two tests above asserting the absence of something nobody has any more.
	 */
	private static String[] whatTheRealmKnowsAbout(String username) {
		JsonNode user = Json.of(InfraFiles.textOf(InfraFiles.keycloakRealm())).get("users").valueStream()
				.filter(entry -> username.equals(entry.path("username").asString())).findFirst()
				.orElseThrow(() -> new AssertionError("No " + username + " user in " + InfraFiles.keycloakRealm()));

		return Stream.of("username", "email", "firstName", "lastName").map(field -> user.path(field).asString())
				.filter(value -> !value.isEmpty()).toArray(String[]::new);
	}

	/** A sign-in of its own each time: a logout ends the session, so the second one needs a second session. */
	private static String freshIdToken() {
		return keycloak.tokensFor("dev", "dev").get("id_token").asString();
	}

	/**
	 * The {@code aud} claim as the list it always logically is. Keycloak writes one audience as a bare string
	 * and several as an array, so a test that reads it as either shape asserts the audience rather than the
	 * user who happened to mint the token.
	 */
	private static List<String> audiencesOf(JsonNode claims) {
		JsonNode audience = claims.get("aud");
		return audience.isArray() ? audience.valueStream().map(JsonNode::asString).toList()
				: List.of(audience.asString());
	}

	/** How long a token is good for, which is the realm's setting arriving where it is actually felt. */
	private static Duration lifespanOf(JsonNode claims) {
		return Duration.ofSeconds(claims.get("exp").asLong() - claims.get("iat").asLong());
	}

	private static String passwordGrantFor(String clientId) {
		return KeycloakFromCompose.errorOf(keycloak.tokenRequest(
				Map.of("grant_type", "password", "client_id", clientId, "username", "dev", "password", "dev"),
				Map.of()));
	}

	/**
	 * A code exchange that cannot succeed, sent only to see whether the origin it comes from is allowed.
	 * Every field of it is nonsense on purpose: CORS is settled before the grant is looked at, so a verifier
	 * that could pass would only suggest this test cared what the token endpoint made of it.
	 */
	private static HttpResponse<String> exchangeFrom(String origin) {
		return keycloak.tokenRequest(
				Map.of("grant_type", "authorization_code", "client_id", EXTENSION_CLIENT, "code", "not-a-code",
						"redirect_uri", EXTENSION_REDIRECT_URI, "code_verifier", "not-a-verifier"),
				Map.of("Origin", origin));
	}

}
