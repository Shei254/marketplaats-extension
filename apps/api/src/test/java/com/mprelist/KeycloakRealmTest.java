package com.mprelist;

import static com.mprelist.KeycloakFromCompose.API_CLIENT;
import static com.mprelist.KeycloakFromCompose.DASHBOARD_CLIENT;
import static com.mprelist.KeycloakFromCompose.DASHBOARD_REDIRECT_URI;
import static com.mprelist.KeycloakFromCompose.EXTENSION_CLIENT;
import static com.mprelist.KeycloakFromCompose.EXTENSION_ID;
import static com.mprelist.KeycloakFromCompose.EXTENSION_REDIRECT_URI;
import static com.mprelist.KeycloakFromCompose.PASSWORD;
import static com.mprelist.KeycloakFromCompose.WELL_FORMED_CHALLENGE;
import static com.mprelist.KeycloakFromCompose.pkce;
import static com.mprelist.KeycloakFromCompose.redirectedError;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
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

	/** Numbers {@link #someUsername()}, so no two registrations in this class collide. */
	private static final AtomicInteger REGISTRATIONS = new AtomicInteger();

	/** Long enough for {@code length(12)} and not a username, which is the whole of what the policy asks. */
	private static final String A_GOOD_PASSWORD = "a-perfectly-fine-password";

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
		assertThat(keycloak.signIn("dev", PASSWORD).get("iss").asString())
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
		assertThat(audiencesOf(keycloak.signIn("dev", PASSWORD))).contains(API_CLIENT);
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
		assertThat(audiencesOf(keycloak.signIn("dev-admin", PASSWORD))).contains(API_CLIENT, "account");
	}

	/**
	 * #27 guards the admin module on this role, so a token has to be able to carry it — and the role is also
	 * the only thing in the token that now says <em>whose</em> it is, `dev-admin` being the one user who holds
	 * it. The username used to be asserted here; the test below is why it is not.
	 */
	@Test
	void andCarriesTheAdminRoleForAnOperatorWhoHasIt() {
		JsonNode claims = keycloak.signIn("dev-admin", PASSWORD);

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
		JsonNode claims = keycloak.signIn("dev", PASSWORD);

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
		JsonNode claims = keycloak.signIn(DASHBOARD_CLIENT, DASHBOARD_REDIRECT_URI, "dev", PASSWORD);

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
	 * The realm this product needs rather than the one three dev users needed: strangers make their own
	 * accounts, so the login page has to offer that and Keycloak has to accept it. Both are off by default.
	 *
	 * <p>Driven through the form rather than the admin API for the usual reason — a realm with
	 * {@code registrationAllowed} imported and a registration flow that refuses everybody reads, from the
	 * outside, exactly like a working one.
	 */
	@Test
	void aStrangerCanMakeAnAccountAndIsSignedInByMakingIt() {
		JsonNode claims = KeycloakFromCompose.claimsOf(keycloak.register(someUsername(), A_GOOD_PASSWORD)
				.orElseThrow(() -> new AssertionError("Keycloak refused the registration: "
						+ keycloak.whyRegistrationWasRefused()))
				.get("access_token").asString());

		assertThat(claims.get("sub").asString()).isNotBlank();
		assertThat(audiencesOf(claims)).contains(API_CLIENT);
	}

	/**
	 * And what they get is the <em>array</em> shape of {@code aud} and a populated {@code realm_access}, which
	 * until now only {@code dev-admin} produced and only because the file grants it {@code default-roles-mprelist}
	 * by hand. A registered user is granted the realm's defaults the way any real user is — so this is the
	 * shape #19 and #27 will actually meet, arriving in the suite from the flow that will actually produce it
	 * rather than from a fixture written to imitate it.
	 */
	@Test
	void andHoldsTheRealmsDefaultRolesTheWayEveryRealUserWill() {
		JsonNode claims = KeycloakFromCompose.claimsOf(keycloak.register(someUsername(), A_GOOD_PASSWORD)
				.orElseThrow(AssertionError::new).get("access_token").asString());

		assertThat(audiencesOf(claims)).contains(API_CLIENT, "account");
		assertThat(claims.get("realm_access").get("roles").valueStream().map(JsonNode::asString))
				.contains("default-roles-mprelist").doesNotContain("ADMIN");
	}

	/**
	 * And nothing they typed into that form reaches our API. The registration page asks for a first name, a
	 * last name and an email address — Keycloak's own form, and not ours to shorten — so the boundary #108
	 * drew is worth proving against the one flow that collects all three at once, rather than only against
	 * users an import wrote.
	 */
	@Test
	void andNothingTheyTypedIntoThatFormReachesOurApi() {
		String username = someUsername();

		JsonNode claims = KeycloakFromCompose.claimsOf(keycloak.register(username, A_GOOD_PASSWORD)
				.orElseThrow(AssertionError::new).get("access_token").asString());

		assertThat(claims.toString()).doesNotContain(username, username + "@example.invalid", "Test", "Person");
	}

	/**
	 * The password policy, at the only moment it is felt: a stranger choosing one. Keycloak ships with no
	 * policy at all, so a realm that takes public registrations without one accepts a single character.
	 *
	 * <p>Both halves are asserted because they fail differently and a length rule alone would let the second
	 * through: {@code notUsername} is what stops the password that is the account name, which is long enough
	 * to pass {@code length(12)} whenever the username is.
	 *
	 * <p><strong>Asserted on what survives a translation.</strong> T80 gave this realm
	 * {@code defaultLocale: nl}, so Keycloak answers in Dutch: what is checked is the field the error
	 * hangs off, the {@code 12} the policy is configured with, and that the second refusal is not the
	 * first one's message. Spelling either sentence out here is what broke when the locale changed, and
	 * it would break again on a Keycloak that reworded its own translation.
	 */
	@Test
	void andTheirPasswordHasToSurviveThePolicyTheRealmSets() {
		String username = someUsername();

		assertThat(keycloak.register(username, "short")).isEmpty();
		assertThat(keycloak.whatRegistrationWasRefusedOn()).contains("password");
		String forBeingShort = keycloak.whyRegistrationWasRefused();
		// `doesNotContain("<")` is what stops this passing on nothing: the reader falls back to the whole
		// page when it finds no error element, and a whole page carries a `12` of its own in the policy
		// block it renders either way. A message is text; a page is markup.
		assertThat(forBeingShort).doesNotContain("<").contains("12");

		assertThat(keycloak.register(username, username)).isEmpty();
		assertThat(keycloak.whatRegistrationWasRefusedOn()).contains("password");
		assertThat(keycloak.whyRegistrationWasRefused()).isNotEqualTo(forBeingShort);
	}

	/**
	 * And guessing at one is answered by the account closing rather than by another prompt. Brute-force
	 * protection is off in a default realm, which is survivable while the only accounts are two the file
	 * wrote and becomes something else entirely the day the accounts belong to strangers.
	 *
	 * <p>Three wrong answers is enough here and 30 is the configured limit, which looks like a contradiction
	 * and is not: Keycloak counts failures arriving faster than {@code quickLoginCheckMilliSeconds} as one
	 * attack rather than as attempts, and locks on those separately. That is the rule this asserts, because
	 * it is the rule a script meets — a human typing their own password wrong three times does not trip it.
	 *
	 * <p>Its own registered user, and not {@code dev}: the assertion is that the account stops working, and
	 * an account this suite signs in as elsewhere is not one to leave locked.
	 */
	@Test
	void andGuessingAtItLocksTheAccountRatherThanInvitingAnotherGuess() {
		String username = someUsername();
		keycloak.register(username, A_GOOD_PASSWORD).orElseThrow(AssertionError::new);

		for (int guess = 0; guess < 3; guess++) {
			assertThat(keycloak.signInSucceeds(username, "definitely-not-the-password")).isFalse();
		}

		assertThat(keycloak.signInSucceeds(username, A_GOOD_PASSWORD)).isFalse();
		assertThat(keycloak.signInSucceeds("dev", PASSWORD)).isTrue();
	}

	/**
	 * And somebody who forgets theirs is offered the way back in. The link is on the login page only when the
	 * realm allows it, so its presence is the setting — and its absence is a user with no route to their own
	 * account but our support address.
	 *
	 * <p>What it does <em>not</em> prove is that the mail arrives: that needs the Mailtrap credentials, which
	 * are the developer's and never this repository's. `infra/README.md` says which two variables, and the
	 * click-through is where a mail is actually read.
	 */
	@Test
	void andSomebodyWhoForgotTheirsIsOfferedTheWayBackIn() {
		HttpResponse<String> loginPage = keycloak.authorizationRequest(EXTENSION_CLIENT, EXTENSION_REDIRECT_URI,
				pkce());

		assertThat(loginPage.body()).contains("reset-credentials");
	}

	/**
	 * And the two credentials that mail needs are not in this repository. They are a secret, and the realm
	 * file is the one place in the stack that would otherwise be a natural home for them.
	 */
	@Test
	void whileTheCredentialsThatMailNeedsStayOutOfTheFile() {
		String realm = InfraFiles.textOf(InfraFiles.keycloakRealm());

		assertThat(realm).contains("\"user\": \"${MPRELIST_SMTP_USER", "\"password\": \"${MPRELIST_SMTP_PASSWORD");
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
		assertThat(keycloak.signIn("dev", PASSWORD).get("realm_access")).isNull();
	}

	/**
	 * ADR-0010 has the extension hold "a rotating refresh token", and rotation is a realm setting Keycloak
	 * leaves <em>off</em>: unset, every refresh token a session ever issued stays valid beside the one that
	 * replaced it, so a copy read out of extension storage outlives the refresh that should have retired it.
	 * The only proof is spending the same token twice.
	 */
	@Test
	void aRefreshTokenIsSpentByTheRefreshThatUsesIt() {
		String issued = keycloak.tokensFor("dev", PASSWORD).get("refresh_token").asString();

		assertThat(keycloak.refresh(issued).statusCode()).isEqualTo(200);
		assertThat(KeycloakFromCompose.errorOf(keycloak.refresh(issued))).isEqualTo("invalid_grant");
	}

	/**
	 * And lives long enough for the refresh to be the on-demand one ADR-0010 asks for. Keycloak's default
	 * session idle timeout is thirty minutes, which an MV3 service worker exceeds by sleeping between one
	 * relist and the next: the refresh then fails, and the extension has to re-run {@code launchWebAuthFlow}
	 * — interactively, since it needs a user gesture. That is the failure "on demand at call time, never on
	 * a timer" was chosen to avoid, and defaulting the timeout reintroduces it.
	 *
	 * <p><strong>To the minute rather than to the second, and that is not slack</strong> (#116). Keycloak does
	 * not compute the two claims from one instant: a refresh token's {@code exp} is the <em>session's</em>
	 * start plus {@code ssoSessionMaxLifespan}, while {@code iat} is the moment the token was minted — later,
	 * by however long the request took. A runner slow enough to cross a second boundary between the two makes
	 * the difference {@code 719H59M59S}, which is how this failed a pull request whose diff was a web page and
	 * some documentation.
	 *
	 * <p>The tolerance is far outside that race and far inside the thing being caught: delete either realm
	 * setting and Keycloak's own defaults are thirty minutes idle and ten hours maximum, so the assertion
	 * still fails by a factor of seventy. What this test is about is the <em>magnitude</em> — a session that
	 * outlives a sleeping worker — and asserting a magnitude to the second is how a suite acquires a failure
	 * that means nothing.
	 */
	@Test
	void andOutlivesAnMv3WorkerThatSleptBetweenCalls() {
		JsonNode refreshToken = KeycloakFromCompose
				.claimsOf(keycloak.tokensFor("dev", PASSWORD).get("refresh_token").asString());

		assertThat(lifespanOf(refreshToken)).isCloseTo(Duration.ofDays(30), Duration.ofMinutes(1));
	}

	/**
	 * While the access token it buys stays short: ADR-0010 accepted that "revocation is only as fast as the
	 * access-token TTL", so how long that is, is the size of the hole the ADR agreed to live with.
	 *
	 * <p>Unlike the two above, this one does not fail if the realm's {@code accessTokenLifespan} is deleted —
	 * five minutes is also Keycloak's default, so there is no mutation to catch. It is kept because
	 * {@link ComposeFile} takes the image tag from compose: the day that default moves under an upgrade, this
	 * runs on the new version and reports it. The subject is the revocation window, not the line.
	 *
	 * <p>And it stays exact where the refresh token above cannot: an access token's {@code exp} is its own
	 * {@code iat} plus a number, both taken from one clock reading, so there is no session start to race
	 * against and nothing here to loosen.
	 */
	@Test
	void whileTheAccessTokenStaysAsShortLivedAsRevocationNeeds() {
		assertThat(lifespanOf(keycloak.signIn("dev", PASSWORD))).isEqualTo(Duration.ofMinutes(5));
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
	 * And the realm file demands HTTPS of anybody who did not say otherwise, while compose says otherwise.
	 * Under {@code external} — Keycloak's default, and this file's — plain HTTP is refused from any client
	 * address Keycloak does not consider local, and a request published through Docker Desktop's port
	 * forwarder reaches the container from a public one: the browser's own sign-in is answered
	 * {@code 403 "HTTPS required"}, which is a failure of the stack that reads nothing like one.
	 *
	 * <p>So the laptop relaxes it and the file does not. A production realm built from this file with the
	 * variable unset keeps {@code external}, which is the whole reason the value is a substitution rather
	 * than the {@code none} a dev realm reaches for — the same trade as the extension id one line above,
	 * inverted: there the environment must be right, here it must be absent.
	 *
	 * <p>Asserted as text, unlike everything else in this class, because the behaviour is not a property of
	 * the realm: whether {@code external} refuses a given request depends on the address the machine presents
	 * to a container, so a test that signed in and expected a refusal would pass on this laptop, fail in CI,
	 * and say nothing about the file either time. What can be got wrong here is the default, and that is a
	 * literal.
	 */
	@Test
	void whileTheFileItselfStillRequiresHttpsOfAnyRealmBuiltFromItElsewhere() {
		assertThat(InfraFiles.textOf(InfraFiles.keycloakRealm()))
				.contains("\"sslRequired\": \"${MPRELIST_SSL_REQUIRED:external}\"");
		assertThat(ComposeFile.setting("MPRELIST_SSL_REQUIRED")).isEqualTo("none");
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

	/**
	 * A username no other test in this class has used. Registration is not undoable through the endpoints
	 * this suite speaks, so every test that registers gets an account of its own rather than sharing one and
	 * depending on the order they ran in.
	 *
	 * <p>Longer than twelve characters on purpose: one test offers the username <em>as</em> the password, and
	 * a short one would be refused for its length before {@code notUsername} was ever consulted — leaving that
	 * half of the policy unasserted while the test passed.
	 */
	private static String someUsername() {
		return "stranger-number-" + REGISTRATIONS.incrementAndGet();
	}

	/** A sign-in of its own each time: a logout ends the session, so the second one needs a second session. */
	private static String freshIdToken() {
		return keycloak.tokensFor("dev", PASSWORD).get("id_token").asString();
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
				Map.of("grant_type", "password", "client_id", clientId, "username", "dev", "password", PASSWORD),
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
