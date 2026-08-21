package com.mprelist;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.MountableFile;

import tools.jackson.databind.JsonNode;

/**
 * A Keycloak that has just imported {@code infra/keycloak/mprelist-realm.json}, on the image
 * {@code infra/docker-compose.yml} runs — the realm file and the version that reads it, and nothing of the
 * local stack, so the suite needs no stack up.
 *
 * <p>Everything below speaks the OIDC endpoints of the {@code mprelist} realm; nothing speaks Keycloak's
 * admin API. Asking the admin API what the realm holds would read the file back through a second spelling of
 * itself — it answers with the configuration, not with the behaviour, so a client that imports and then
 * refuses every login reads exactly like one that works.
 *
 * <p>{@code KC_HOSTNAME} is deliberately not set, unlike in compose: without it Keycloak derives the issuer
 * from the request, which is what lets this run on whatever port Docker maps rather than on a fixed 8081.
 *
 * <p>{@code MPRELIST_SSL_REQUIRED} <em>is</em> taken from compose, and it is the one setting here that has to
 * be. Every request below is plain HTTP to a published port, and under {@code external} — Keycloak's default,
 * and the realm file's when the variable is unset — Keycloak refuses that from any client address it does not
 * consider local, answering {@code 403 "HTTPS required"} before a single test runs. Whether the address it
 * sees is local is a property of the machine, not of this repository: through Docker Desktop's port forwarder
 * it is public, on a rootful daemon it is the bridge gateway. Reading the value compose sets means the suite
 * starts the realm the local stack starts, rather than one that happens to work on the reviewer's laptop.
 *
 * <p>Which realm starts is a choice: {@link #withTheExtensionIdSet()} is what a developer who set
 * {@code MPRELIST_EXTENSION_ID} gets, {@link #withNoExtensionIdSet()} what one who never did gets. Both are
 * shipped states — until #13 pins an id, the second is every developer's — so both are proven, by
 * {@link KeycloakRealmTest} and {@link KeycloakRealmWithoutAnExtensionIdTest} respectively.
 */
final class KeycloakFromCompose implements AutoCloseable {

	/** Not a real Chrome extension id, but the same shape — 32 letters a–p. */
	static final String EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";

	static final String REALM = "mprelist";

	static final String EXTENSION_CLIENT = "mprelist-extension";

	static final String DASHBOARD_CLIENT = "mprelist-dashboard";

	static final String API_CLIENT = "mprelist-api";

	static final String EXTENSION_REDIRECT_URI = "https://" + EXTENSION_ID + ".chromiumapp.org/";

	static final String DASHBOARD_REDIRECT_URI = "http://localhost:5173/";

	/**
	 * The literal the realm file falls back to — its own {@code ${MPRELIST_EXTENSION_ID:unset-extension-id}}
	 * default, spelled here so that a test can tell the fallback applying from the import failing.
	 */
	static final String UNSET_EXTENSION_ID = "unset-extension-id";

	static final String FALLBACK_REDIRECT_URI = "https://" + UNSET_EXTENSION_ID + ".chromiumapp.org/";

	/**
	 * A syntactically well-formed {@code code_challenge}: 43 base64url characters, which is the length
	 * base64url-encoded SHA-256 always produces. It is the hash of nothing — no verifier here matches it —
	 * which is all the requests that never reach a code exchange need.
	 *
	 * <p>Well formed on purpose: Keycloak refuses a short challenge for being short, so a sloppier one would
	 * leave the PKCE tests green against a realm that requires no challenge at all.
	 */
	static final String WELL_FORMED_CHALLENGE = "a".repeat(43);

	/** A well-formed PKCE pair, for the requests whose subject is something other than PKCE. */
	static Map<String, String> pkce() {
		return s256(WELL_FORMED_CHALLENGE);
	}

	/** The realm a developer who set {@code MPRELIST_EXTENSION_ID} gets. */
	static KeycloakFromCompose withTheExtensionIdSet() {
		return new KeycloakFromCompose(Map.of("MPRELIST_EXTENSION_ID", EXTENSION_ID));
	}

	/**
	 * The realm a developer who never set it gets, which until #13 pins an id is every developer.
	 * {@code docker-compose.yml} declares the variable with no value of its own, so an unset shell reaches
	 * the import as an unset variable and the realm file's own default is what applies.
	 */
	static KeycloakFromCompose withNoExtensionIdSet() {
		return new KeycloakFromCompose(Map.of());
	}

	private KeycloakFromCompose(Map<String, String> environment) {
		Map<String, String> imported = new LinkedHashMap<>(environment);
		imported.put("MPRELIST_SSL_REQUIRED", ComposeFile.setting("MPRELIST_SSL_REQUIRED"));

		this.container = new GenericContainer<>(ComposeFile.image("quay.io/keycloak/keycloak"))
				.withCommand("start-dev", "--import-realm")
				.withEnv(imported)
				.withCopyFileToContainer(MountableFile.forHostPath(InfraFiles.keycloakRealm()),
						"/opt/keycloak/data/import/mprelist-realm.json")
				.withExposedPorts(8080)
				// The realm's own discovery document: the import runs before the HTTP port opens, so this
				// waits for an imported realm rather than merely for a started Keycloak.
				.waitingFor(Wait.forHttp(realmPath("/.well-known/openid-configuration")).forPort(8080)
						.forStatusCode(200))
				.withStartupTimeout(Duration.ofMinutes(3));
		this.container.start();
	}

	@Override
	public void close() {
		this.container.stop();
	}

	String baseUrl() {
		return "http://" + this.container.getHost() + ":" + this.container.getMappedPort(8080);
	}

	/**
	 * The authorization request a client makes, with {@code parameters} replacing or adding to the ones
	 * every such request carries. Returned unfollowed and unchecked: a refusal arrives either as a redirect
	 * carrying {@code error} — when Keycloak trusts the redirect URI enough to use it — or as a 400 page
	 * when it does not, and which of the two happens is itself the subject of some of these tests.
	 */
	HttpResponse<String> authorizationRequest(String clientId, String redirectUri, Map<String, String> parameters) {
		return Http.send(HttpRequest.newBuilder(URI.create(authorizationUrl(clientId, redirectUri, parameters)))
				.GET().build());
	}

	/**
	 * The URL of that same request, for the one caller that has to build the request itself rather than send
	 * it as it stands — {@link #tokensFor} carries a cookie jar through the login form that follows.
	 */
	private String authorizationUrl(String clientId, String redirectUri, Map<String, String> parameters) {
		Map<String, String> query = new LinkedHashMap<>();
		query.put("client_id", clientId);
		query.put("response_type", "code");
		query.put("scope", "openid");
		query.put("redirect_uri", redirectUri);
		query.put("state", "a-state");
		query.putAll(parameters);
		return realmUrl("/protocol/openid-connect/auth?" + encode(query));
	}

	/**
	 * An RP-initiated logout, returned unfollowed: whether Keycloak bounces to {@code postLogoutRedirectUri}
	 * or answers a 400 page is exactly what says which URIs the client will return a browser to.
	 */
	HttpResponse<String> logout(String idToken, String postLogoutRedirectUri) {
		return Http.send(HttpRequest.newBuilder(URI.create(realmUrl("/protocol/openid-connect/logout?"
				+ encode(Map.of("id_token_hint", idToken, "post_logout_redirect_uri", postLogoutRedirectUri)))))
				.GET().build());
	}

	/** A token request as posted, with no expectation of success — several tests are about the refusal. */
	HttpResponse<String> tokenRequest(Map<String, String> fields, Map<String, String> headers) {
		HttpRequest.Builder request = formRequest(realmUrl("/protocol/openid-connect/token"), fields);
		headers.forEach(request::header);
		return Http.send(request.build());
	}

	/** The claims of the access token a full sign-in mints, as the extension. */
	JsonNode signIn(String username, String password) {
		return signIn(EXTENSION_CLIENT, EXTENSION_REDIRECT_URI, username, password);
	}

	/**
	 * And as whichever client is asked for, which is how the dashboard's tokens are read: it holds a user's
	 * session too and sends what it mints to the same API, so what its tokens carry is the same question.
	 */
	JsonNode signIn(String clientId, String redirectUri, String username, String password) {
		return claimsOf(tokensFor(clientId, redirectUri, username, password).get("access_token").asString());
	}

	/**
	 * A refresh as the extension performs it — on demand at call time, ADR-0010 having ruled out a timer.
	 * Returned unchecked: that a spent token is refused is the subject of a test, not a failure of one.
	 */
	HttpResponse<String> refresh(String refreshToken) {
		return tokenRequest(Map.of("grant_type", "refresh_token", "client_id", EXTENSION_CLIENT, "refresh_token",
				refreshToken), Map.of());
	}

	/** That sign-in as the extension, which is the client these tests mostly speak as. */
	JsonNode tokensFor(String username, String password) {
		return tokensFor(EXTENSION_CLIENT, EXTENSION_REDIRECT_URI, username, password);
	}

	/**
	 * A full Authorization Code + PKCE sign-in, driven the way a public client drives it: authorization
	 * request, the login form Keycloak answers with, then the code exchanged with the verifier. Returns the
	 * token endpoint's whole answer — the access token, and the refresh token beside it.
	 *
	 * <p>Nothing here is a shortcut around the realm — a password grant would be, and both public clients
	 * refuse it — so what this proves is what a token minted through the configured flow actually carries.
	 */
	JsonNode tokensFor(String clientId, String redirectUri, String username, String password) {
		String verifier = randomVerifier();
		Cookies cookies = new Cookies();

		HttpResponse<String> loginPage = Http.send(cookies.on(HttpRequest.newBuilder(URI.create(authorizationUrl(
				clientId, redirectUri, s256(challengeFor(verifier))))).GET()).build());
		cookies.harvest(loginPage);

		HttpResponse<String> submitted = Http.send(cookies
				.on(formRequest(loginFormAction(loginPage.body()), Map.of("username", username, "password", password)))
				.build());
		String location = submitted.headers().firstValue("location")
				.orElseThrow(() -> new IllegalStateException("Keycloak did not redirect after the login form; it "
						+ "answered " + submitted.statusCode() + " with " + submitted.body()));

		HttpResponse<String> exchanged = tokenRequest(Map.of(
				"grant_type", "authorization_code",
				"client_id", clientId,
				"code", parameterOf(location, "code"),
				"redirect_uri", redirectUri,
				"code_verifier", verifier), Map.of());
		if (exchanged.statusCode() != 200) {
			throw new IllegalStateException("Keycloak refused the code exchange with " + exchanged.statusCode() + ": "
					+ exchanged.body());
		}
		return Json.of(exchanged);
	}

	/** The {@code error} of an OAuth error response, which is how the token endpoint states a refusal. */
	static String errorOf(HttpResponse<String> response) {
		return Json.of(response).get("error").asString();
	}

	/** The middle segment of a JWT, which is where every claim these tests are about lives. */
	static JsonNode claimsOf(String jwt) {
		return Json.of(Base64.getUrlDecoder().decode(jwt.split("\\.")[1]));
	}

	/** A query parameter of a redirect target, which is how Keycloak returns both a code and a refusal. */
	static String parameterOf(String url, String name) {
		Matcher parameter = Pattern.compile("[?&]" + name + "=([^&]*)").matcher(url);
		if (!parameter.find()) {
			throw new IllegalStateException("No " + name + " in " + url);
		}
		return URLDecoder.decode(parameter.group(1), UTF_8);
	}

	/**
	 * The {@code error} of a refusal Keycloak sent back through the redirect URI, which it only does for a
	 * request whose client and redirect URI it accepted.
	 */
	static String redirectedError(HttpResponse<String> response) {
		String location = response.headers().firstValue("location")
				.orElseThrow(() -> new AssertionError("Keycloak did not refuse the request through the redirect URI; "
						+ "it answered " + response.statusCode() + " with no redirect at all"));
		return parameterOf(location, "error");
	}

	private static String realmPath(String path) {
		return "/realms/" + REALM + path;
	}

	private String realmUrl(String path) {
		return baseUrl() + realmPath(path);
	}

	/**
	 * Keycloak answers an authorization request with a login page whose form posts back to a one-shot URL.
	 * Following it is the whole of "logging in" here; there is no other way to reach a code.
	 */
	private static String loginFormAction(String html) {
		Matcher action = Pattern.compile("action=\"([^\"]*)\"").matcher(html);
		if (!action.find()) {
			throw new IllegalStateException("No login form in Keycloak's answer to the authorization request");
		}
		return action.group(1).replace("&amp;", "&");
	}

	private static HttpRequest.Builder formRequest(String url, Map<String, String> fields) {
		return HttpRequest.newBuilder(URI.create(url)).header("Content-Type", "application/x-www-form-urlencoded")
				.POST(HttpRequest.BodyPublishers.ofString(encode(fields)));
	}

	/**
	 * The session cookie Keycloak sets on the login page and demands back on the form post, carried by
	 * hand rather than by a {@code java.net.CookieManager}: the JDK's own jar drops every cookie whose host
	 * has no dot in it, and Testcontainers' host is {@code localhost}. The symptom is not a missing cookie
	 * but a 400 with the login page again, which reads exactly like a wrong password.
	 */
	private static final class Cookies {

		HttpRequest.Builder on(HttpRequest.Builder request) {
			return this.jar.isEmpty() ? request : request.header("Cookie", this.jar.entrySet().stream()
					.map(cookie -> cookie.getKey() + "=" + cookie.getValue()).reduce((one, two) -> one + "; " + two)
					.orElseThrow());
		}

		void harvest(HttpResponse<?> response) {
			for (String header : response.headers().allValues("set-cookie")) {
				String pair = header.split(";", 2)[0];
				int equals = pair.indexOf('=');
				if (equals > 0) {
					this.jar.put(pair.substring(0, equals).trim(), pair.substring(equals + 1).trim());
				}
			}
		}

		private final Map<String, String> jar = new LinkedHashMap<>();

	}

	private static String encode(Map<String, String> parameters) {
		return parameters.entrySet().stream()
				.map(parameter -> URLEncoder.encode(parameter.getKey(), UTF_8) + "="
						+ URLEncoder.encode(parameter.getValue(), UTF_8))
				.reduce((one, two) -> one + "&" + two).orElse("");
	}

	private static String randomVerifier() {
		byte[] entropy = new byte[48];
		new SecureRandom().nextBytes(entropy);
		return Base64.getUrlEncoder().withoutPadding().encodeToString(entropy);
	}

	/** A challenge and the method it was made by, which have no meaning apart and so never travel apart. */
	private static Map<String, String> s256(String codeChallenge) {
		return Map.of("code_challenge", codeChallenge, "code_challenge_method", "S256");
	}

	private static String challengeFor(String verifier) {
		try {
			return Base64.getUrlEncoder().withoutPadding()
					.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(UTF_8)));
		}
		catch (NoSuchAlgorithmException impossible) {
			throw new IllegalStateException("SHA-256 is required of every JVM", impossible);
		}
	}

	private final GenericContainer<?> container;

}
