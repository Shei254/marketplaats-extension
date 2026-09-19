package com.mprelist;

import static com.mprelist.KeycloakFromCompose.DASHBOARD_CLIENT;
import static com.mprelist.KeycloakFromCompose.EXTENSION_CLIENT;
import static com.mprelist.KeycloakFromCompose.EXTENSION_ID;
import static com.mprelist.KeycloakFromCompose.EXTENSION_REDIRECT_URI;
import static com.mprelist.KeycloakFromCompose.PASSWORD;
import static com.mprelist.KeycloakFromCompose.pkce;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;

/**
 * {@code infra/keycloak-production/mprelist-realm.json} — the realm a deployment imports (T56, #87).
 *
 * <p><strong>This is the file in the repository whose mistakes cost the most and show the least.</strong>
 * Keycloak imports a realm on first start and never again while its database exists, so everything here is
 * read exactly once, on a machine that by then has accounts on it, and undoing it is a {@code down -v} —
 * every user, every session, gone. The two realms also look almost identical in a diff, which is the other
 * half of the problem: the differences that matter are two users who must not be there and a set of origins
 * that must not be {@code localhost}.
 *
 * <p>So a container starts on it. Reading the JSON would prove the file says what we think and nothing about
 * whether Keycloak agrees: a substitution that silently does not happen, a client Keycloak refuses to
 * import, and a realm that comes up correctly are three outcomes no text assertion can tell apart. The
 * cheaper claims — that no dev user is in the file at all, that no hostname is written into it — are here
 * too, because they are about the same file and a reader should find them together.
 *
 * <p>{@code MPRELIST_SSL_REQUIRED} is set to what {@code docker-compose.yml} sets, exactly as
 * {@link KeycloakFromCompose} does for the local realm and for the same reason: every request below is plain
 * HTTP to a published port, which {@code external} refuses from a non-local address. The deployed compose
 * file passes that variable nowhere — {@link DeployedStackTest} is what holds it to that — so the realm's own
 * {@code external} is what applies in production.
 */
class ProductionRealmTest {

	/**
	 * The two site origins the deployed compose file hands the import. Spelled as a deployment spells them:
	 * {@code https}, no trailing slash, two different hostnames for one bundle (ADR-0017).
	 */
	private static final String WEB_ORIGIN = "https://www.example.test";

	private static final String ADMIN_ORIGIN = "https://admin.example.test";

	private static KeycloakFromCompose keycloak;

	@BeforeAll
	static void startKeycloak() {
		keycloak = KeycloakFromCompose.productionRealm(Map.of(
				"MPRELIST_EXTENSION_ID", EXTENSION_ID,
				"MPRELIST_WEB_BASE_URL", WEB_ORIGIN,
				"MPRELIST_ADMIN_BASE_URL", ADMIN_ORIGIN));
	}

	@AfterAll
	static void stopKeycloak() {
		keycloak.close();
	}

	/**
	 * It imports at all, and registers the published extension.
	 *
	 * <p>That it started is most of the claim — {@link KeycloakFromCompose} waits on the realm's own
	 * discovery document, so a realm Keycloak refused would never get here. A 200 is the login page, which
	 * Keycloak renders only for a client and a redirect URI it accepts.
	 */
	@Test
	void importsAndRegistersThePublishedExtension() {
		assertThat(keycloak.authorizationRequest(EXTENSION_CLIENT, EXTENSION_REDIRECT_URI, pkce()).statusCode())
				.isEqualTo(200);
	}

	/**
	 * And the admin corner signs in from <em>both</em> hostnames, because it is one bundle at two of them.
	 *
	 * <p>{@code apps/web} picks its surface by path and knows nothing about the host (ADR-0017), so
	 * {@code www.} and {@code admin.} are the same client arriving from two origins. The redirect URI is the
	 * origin root in both cases — {@code admin-config.ts} takes it from {@code location.origin} — and
	 * Keycloak matches redirect URIs exactly, so a realm registering one of the two is a realm where signing
	 * in works on whichever hostname somebody happened to test.
	 */
	@Test
	void andSignsTheAdminCornerInFromBothOfItsHostnames() {
		for (String origin : new String[] { WEB_ORIGIN, ADMIN_ORIGIN }) {
			assertThat(keycloak.authorizationRequest(DASHBOARD_CLIENT, origin + "/", pkce()).statusCode())
					.withFailMessage("the production realm does not accept %s/ as a redirect URI", origin)
					.isEqualTo(200);
		}
	}

	/**
	 * And refuses an origin it was not given, which is what makes the substitution above worth anything.
	 *
	 * <p>Without this, a realm that had ignored both variables and registered the literal
	 * {@code ${MPRELIST_WEB_BASE_URL:…}} default would still be a realm that refuses nothing — and the test
	 * above would be passing on a fallback rather than on the deployment's own hostnames.
	 */
	@Test
	void andRefusesAnOriginItWasNeverGiven() {
		assertThat(keycloak.authorizationRequest(DASHBOARD_CLIENT, "https://elsewhere.example.test/", pkce())
				.statusCode()).isEqualTo(400);
	}

	/**
	 * And it carries no account anybody could sign in as.
	 *
	 * <p>The local realm ships two users sharing a password this repository publishes. Pointing
	 * {@code MPRELIST_REALM_DIR} at {@code ./keycloak} is the obvious first mistake and it is silent: the
	 * stack comes up, signs in, and looks exactly like a working deployment — to whoever read the password in
	 * git as well.
	 */
	@Test
	void andHasNoUserTheLocalStacksPasswordWouldOpen() {
		assertThat(keycloak.signInSucceeds("dev", PASSWORD)).isFalse();
		assertThat(keycloak.signInSucceeds("dev-admin", PASSWORD)).isFalse();
	}

	/**
	 * While a stranger can still make an account, which is the product working.
	 *
	 * <p>ADR-0008: strangers register themselves, there is no invitation step, and the first sign-in is what
	 * provisions them here. A production realm with registration off is a product nobody can buy.
	 */
	@Test
	void whileAStrangerCanStillMakeOne() {
		assertThat(keycloak.registrationPage().statusCode()).isEqualTo(200);
	}

	// --- the file itself, which is the same subject read a cheaper way ----------------------------------

	/**
	 * No user is in the file at all — not a disabled one, not one without credentials.
	 *
	 * <p>The test above proves the two the local realm ships cannot sign in. This proves the file grew no
	 * others, which is the shape the mistake would actually take: an account added for a click-through and
	 * left behind.
	 */
	@Test
	void andTheFileDeclaresNoUsers() {
		assertThat(Json.of(realm()).has("users")).isFalse();
	}

	/**
	 * And writes down no hostname, so that this export is not one deployment's.
	 *
	 * <p>Every address in it is a {@code ${…}} substitution the compose file fills in — which is what makes
	 * the move from sslip.io to a real domain a change to {@code production.env} and a {@code down -v} of a
	 * stack with no users on it yet, rather than a commit.
	 */
	@Test
	void andWritesDownNoHostnameOfItsOwn() {
		assertThat(realm()).doesNotContain("localhost").doesNotContain("127.0.0.1");

		for (JsonNode client : Json.of(realm()).get("clients")) {
			for (JsonNode redirectUri : client.get("redirectUris")) {
				assertThat(redirectUri.asText())
						.withFailMessage("%s registers %s, which is one deployment's address written into git",
								client.get("clientId").asText(), redirectUri.asText())
						.contains("${");
			}
		}
	}

	/**
	 * And its sign-in page is ours, in the product's language.
	 *
	 * <p><strong>This replaces a test that was commented out, and the reason it was is the reason T80
	 * exists.</strong> What stood here asserted that this realm's {@code displayName} equalled
	 * {@code brand.json}'s {@code name}, because the base login template renders {@code realm.displayName}
	 * and an import is not a build — so there was no token to resolve and the name had to be kept in step by
	 * hand. It was not: the file said {@code Bumpr} while {@code brand.json} had moved on, which is the exact
	 * drift T48 (#78) removed everywhere it could reach, surviving in the one place it could not.
	 *
	 * <p>The answer was not to keep the copy in step. It was to stop the page reading it: the login theme
	 * (T80, {@code docs/adr/0033-the-login-page-is-ours-and-is-generated.md}) replaces that template and
	 * takes the name from {@code brand.json} at build time, so {@code displayName} is now what Keycloak means
	 * by it — an administrator's label for the realm, on no page a customer sees.
	 *
	 * <p>So what is left for this file to say is which theme the realm asks for, and in what language. The
	 * theme's own contents are asserted in {@code apps/keycloak-theme}, in the workspace that builds it: no
	 * artefact crosses between the Gradle and npm halves of this repository (ADR-0011), and the Keycloak this
	 * test starts therefore has no theme directory — it logs that it could not find one and serves its
	 * built-in pages, which is why nothing below reads the markup.
	 */
	@Test
	void andItsSignInPageIsOursAndInDutch() {
		JsonNode realm = Json.of(realm());
		assertThat(realm.get("loginTheme").asText())
				.withFailMessage("the production realm does not ask for the `mprelist` login theme, so a "
						+ "deployment signs customers in on Keycloak's own page — which renders this realm's "
						+ "displayName, in English, with no mark on it (ADR-0033).")
				.isEqualTo("mprelist");
		assertThat(realm.get("internationalizationEnabled").asBoolean()).isTrue();
		assertThat(realm.get("defaultLocale").asText()).isEqualTo("nl");
	}

	private static String realm() {
		return InfraFiles.textOf(InfraFiles.productionKeycloakRealm());
	}

}
