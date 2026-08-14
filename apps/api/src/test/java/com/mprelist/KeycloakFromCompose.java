package com.mprelist;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
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
import tools.jackson.databind.json.JsonMapper;

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
 * <p>The realm is mounted with a known {@code MPRELIST_EXTENSION_ID}, so what starts here is the realm a
 * developer who set that variable gets, not the fallback one.
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

	/** The 43 characters RFC 7636 asks for at minimum. Anything shorter Keycloak refuses for its length. */
	static final String WELL_FORMED_CHALLENGE = "a".repeat(43);

	KeycloakFromCompose() {
		this.container = new GenericContainer<>(ComposeFile.image("quay.io/keycloak/keycloak"))
				.withCommand("start-dev", "--import-realm")
				.withEnv("MPRELIST_EXTENSION_ID", EXTENSION_ID)
				.withCopyFileToContainer(MountableFile.forHostPath(ComposeFile.sibling(REALM_FILE)),
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
		Map<String, String> query = new LinkedHashMap<>();
		query.put("client_id", clientId);
		query.put("response_type", "code");
		query.put("scope", "openid");
		query.put("redirect_uri", redirectUri);
		query.put("state", "a-state");
		query.putAll(parameters);
		return send(HttpRequest.newBuilder(URI.create(realmUrl("/protocol/openid-connect/auth?" + encode(query))))
				.GET().build());
	}

	/** A token request as posted, with no expectation of success — several tests are about the refusal. */
	HttpResponse<String> tokenRequest(Map<String, String> fields, Map<String, String> headers) {
		HttpRequest.Builder request = formRequest(realmUrl("/protocol/openid-connect/token"), fields);
		headers.forEach(request::header);
		return send(request.build());
	}

	/**
	 * A full Authorization Code + PKCE sign-in, driven the way the extension will drive it: authorization
	 * request, the login form Keycloak answers with, then the code exchanged with the verifier. Returns the
	 * access token's claims.
	 *
	 * <p>Nothing here is a shortcut around the realm — a password grant would be, and the extension client
	 * refuses it — so what this proves is what a token minted through the configured flow actually carries.
	 */
	JsonNode signIn(String username, String password) {
		String verifier = randomVerifier();
		Cookies cookies = new Cookies();

		HttpResponse<String> loginPage = send(cookies.on(HttpRequest.newBuilder(URI.create(realmUrl(
				"/protocol/openid-connect/auth?" + encode(Map.of(
						"client_id", EXTENSION_CLIENT,
						"response_type", "code",
						"scope", "openid",
						"redirect_uri", EXTENSION_REDIRECT_URI,
						"state", "a-state",
						"code_challenge", challengeFor(verifier),
						"code_challenge_method", "S256"))))).GET()).build());
		cookies.harvest(loginPage);

		HttpResponse<String> submitted = send(cookies
				.on(formRequest(loginFormAction(loginPage.body()), Map.of("username", username, "password", password)))
				.build());
		String location = submitted.headers().firstValue("location")
				.orElseThrow(() -> new IllegalStateException("Keycloak did not redirect after the login form; it "
						+ "answered " + submitted.statusCode() + " with " + submitted.body()));

		HttpResponse<String> exchanged = tokenRequest(Map.of(
				"grant_type", "authorization_code",
				"client_id", EXTENSION_CLIENT,
				"code", parameterOf(location, "code"),
				"redirect_uri", EXTENSION_REDIRECT_URI,
				"code_verifier", verifier), Map.of());
		if (exchanged.statusCode() != 200) {
			throw new IllegalStateException("Keycloak refused the code exchange with " + exchanged.statusCode() + ": "
					+ exchanged.body());
		}
		return claimsOf(JSON.readTree(exchanged.body()).get("access_token").asString());
	}

	/** The {@code error} of an OAuth error response, which is how the token endpoint states a refusal. */
	static String errorOf(HttpResponse<String> response) {
		return JSON.readTree(response.body()).get("error").asString();
	}

	/** The middle segment of a JWT, which is where every claim these tests are about lives. */
	private static JsonNode claimsOf(String jwt) {
		return JSON.readTree(Base64.getUrlDecoder().decode(jwt.split("\\.")[1]));
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

	private static String challengeFor(String verifier) {
		try {
			return Base64.getUrlEncoder().withoutPadding()
					.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(UTF_8)));
		}
		catch (NoSuchAlgorithmException impossible) {
			throw new IllegalStateException("SHA-256 is required of every JVM", impossible);
		}
	}

	private static HttpResponse<String> send(HttpRequest request) {
		try {
			return SHARED.send(request, HttpResponse.BodyHandlers.ofString());
		}
		catch (IOException failed) {
			throw new UncheckedIOException("Cannot reach " + request.uri(), failed);
		}
		catch (InterruptedException interrupted) {
			Thread.currentThread().interrupt();
			throw new IllegalStateException("Interrupted waiting for " + request.uri(), interrupted);
		}
	}

	private final GenericContainer<?> container;

	/** Redirects are never followed: a redirect is the answer these tests read, not a step on the way to it. */
	private static final HttpClient SHARED = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final String REALM_FILE = "infra/keycloak/mprelist-realm.json";

}
