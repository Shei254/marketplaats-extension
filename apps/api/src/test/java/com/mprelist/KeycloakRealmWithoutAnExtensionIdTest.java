package com.mprelist;

import static com.mprelist.KeycloakFromCompose.EXTENSION_CLIENT;
import static com.mprelist.KeycloakFromCompose.EXTENSION_REDIRECT_URI;
import static com.mprelist.KeycloakFromCompose.FALLBACK_REDIRECT_URI;
import static com.mprelist.KeycloakFromCompose.pkce;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * The realm a developer gets who has <em>not</em> set {@code MPRELIST_EXTENSION_ID} — which, until #13 pins
 * an id, is every developer on their first run.
 *
 * <p>{@link KeycloakRealmTest} always sets the variable, so nothing there can see this path: a realm that
 * refused to import, one that registered the literal {@code ${MPRELIST_EXTENSION_ID:unset-extension-id}}
 * unsubstituted, and one that fell back correctly are indistinguishable from a suite that never runs without
 * it. The fallback is the shipped default and {@code infra/README.md} describes its behaviour in prose, so
 * it is worth a container of its own — this is the only thing in the suite that would notice it breaking.
 */
class KeycloakRealmWithoutAnExtensionIdTest {

	private static KeycloakFromCompose keycloak;

	@BeforeAll
	static void startKeycloak() {
		keycloak = KeycloakFromCompose.withNoExtensionIdSet();
	}

	@AfterAll
	static void stopKeycloak() {
		keycloak.close();
	}

	/**
	 * The realm imports, and the extension client comes up registered at the literal the file falls back to.
	 * A 200 is Keycloak's login page, which it renders only for a client and a redirect URI it accepts — so
	 * this separates "the default applied" from the two ways it could have gone wrong quietly.
	 */
	@Test
	void theRealmImportsAndRegistersTheLiteralItFallsBackTo() {
		assertThat(keycloak.authorizationRequest(EXTENSION_CLIENT, FALLBACK_REDIRECT_URI, pkce()).statusCode())
				.isEqualTo(200);
	}

	/**
	 * And a real extension is refused — with the page {@code infra/README.md} promises, by the error string
	 * it names. That is the point of falling back to a literal that is a <em>valid URI matching no real
	 * flow</em>, rather than to an empty string: the realm imports and then refuses cleanly, instead of
	 * failing to import or registering a URI with no host in it.
	 */
	@Test
	void whileARealExtensionIsRefusedRatherThanHavingACodeBouncedSomewhere() {
		HttpResponse<String> aRealExtension = keycloak.authorizationRequest(EXTENSION_CLIENT,
				EXTENSION_REDIRECT_URI, pkce());

		assertThat(aRealExtension.statusCode()).isEqualTo(400);
		assertThat(aRealExtension.headers().firstValue("location")).isEmpty();
		assertThat(aRealExtension.body()).contains("Invalid parameter: redirect_uri");
	}

}
