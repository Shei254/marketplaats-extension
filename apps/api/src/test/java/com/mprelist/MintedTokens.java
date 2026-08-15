package com.mprelist;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.function.UnaryOperator;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * An RSA key, the tokens it signs, and the two documents a resource server has to fetch to check one: a
 * discovery document at the issuer, and the JWKS it points at. Enough for {@link ResourceServerTest} to mint
 * a token that is wrong in exactly one way and watch it be refused.
 *
 * <p>Not a Keycloak. Starting one would prove the realm rather than this application — that is
 * {@link KeycloakRealmTest}'s subject, and it is the reason a container there is worth its minute — while
 * costing this suite the one thing it needs, which is a token this API should <em>not</em> accept. Keycloak
 * will not mint an expired token, or one for an audience no client asks for, or one signed by a key it never
 * published; every refusal below would have to be arranged by lying to Keycloak instead, and half of them
 * could not be arranged at all.
 *
 * <p>What it is <em>not</em> free to differ on is the shape. The path is Keycloak's {@code /realms/<name>},
 * the lifetime is the realm's own {@code accessTokenLifespan}, the audience is the client the realm's mappers
 * name, and one audience is written as a bare string and several as an array, exactly as Keycloak writes
 * them. A stub that answered in a shape no IdP produces would prove the decoder reads the stub.
 */
final class MintedTokens implements AutoCloseable {

	/** The {@code sub} of a token minted here: opaque, and shaped like the UUID Keycloak issues. */
	static final String SUBJECT = "3f8c1a54-6b2e-4a19-9d77-0e5c2b8a4f31";

	/** What the realm's audience mappers put in a token, and what {@code application.yml} requires of one. */
	static final String AUDIENCE = KeycloakFromCompose.API_CLIENT;

	/** A key, a JWKS and a discovery document, on a loopback port of the operating system's choosing. */
	static MintedTokens servingItsKeys() {
		return new MintedTokens();
	}

	/** Where this issuer says it is, and so the value {@code issuer-uri} has to be pointed at. */
	String issuerUri() {
		return "http://" + this.server.getAddress().getHostString() + ":" + this.server.getAddress().getPort()
				+ REALM_PATH;
	}

	/** A token with nothing wrong with it: this issuer, this API's audience, in date, signed and published. */
	String token() {
		return token(UnaryOperator.identity());
	}

	/**
	 * The same token with one thing changed, which is how every refusal below is arranged — the claim under
	 * test is the only thing that differs from a token that works.
	 */
	String token(UnaryOperator<JWTClaimsSet.Builder> claims) {
		return signedWith(this.key, claims);
	}

	/**
	 * A token signed by a second key, under the key id of the one this issuer publishes. Announcing the
	 * published key is what makes it the sharper forgery: the decoder finds a key to check against and the
	 * signature is what fails, where a made-up key id would be turned away before any signature was checked.
	 */
	String tokenSignedByAKeyThisIssuerNeverPublished() {
		return signedWith(generateKey(this.key.getKeyID()), UnaryOperator.identity());
	}

	@Override
	public void close() {
		this.server.stop(0);
	}

	private String signedWith(RSAKey signingKey, UnaryOperator<JWTClaimsSet.Builder> claims) {
		SignedJWT token = new SignedJWT(
				new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(signingKey.getKeyID()).build(),
				claims.apply(wellFormed()).build());
		try {
			token.sign(new RSASSASigner(signingKey));
		}
		catch (JOSEException impossible) {
			throw new IllegalStateException("Cannot sign with a key generated for signing", impossible);
		}
		return token.serialize();
	}

	/**
	 * Five minutes, because that is the realm's {@code accessTokenLifespan} and the revocation window
	 * ADR-0010 agreed to live with. A test about expiry has to reach past the resource server's own 60-second
	 * clock skew to say anything, so it names its own times rather than nudging these.
	 */
	private JWTClaimsSet.Builder wellFormed() {
		Instant now = Instant.now();
		return new JWTClaimsSet.Builder()
				.issuer(issuerUri())
				.subject(SUBJECT)
				.audience(AUDIENCE)
				.issueTime(Date.from(now))
				.expirationTime(Date.from(now.plus(Duration.ofMinutes(5))));
	}

	private MintedTokens() {
		this.key = generateKey("mprelist-test");
		try {
			this.server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
		}
		catch (IOException noPort) {
			throw new UncheckedIOException("Cannot open a port for the issuer these tokens claim to come from",
					noPort);
		}
		// Fetched in this order by a decoder that has only been given an issuer: the document says where the
		// keys are, and Spring refuses a document whose own `issuer` is not the location it was asked for.
		this.server.createContext(REALM_PATH + DISCOVERY_PATH, exchange -> respond(exchange, discoveryDocument()));
		this.server.createContext(REALM_PATH + JWKS_PATH,
				exchange -> respond(exchange, new JWKSet(this.key.toPublicJWK()).toString()));
		this.server.start();
	}

	private String discoveryDocument() {
		return """
				{
				  "issuer": "%1$s",
				  "authorization_endpoint": "%1$s/protocol/openid-connect/auth",
				  "token_endpoint": "%1$s/protocol/openid-connect/token",
				  "jwks_uri": "%1$s%2$s",
				  "response_types_supported": ["code"],
				  "subject_types_supported": ["public"],
				  "id_token_signing_alg_values_supported": ["RS256"]
				}""".formatted(issuerUri(), JWKS_PATH);
	}

	private static RSAKey generateKey(String keyId) {
		try {
			return new RSAKeyGenerator(2048)
					.keyID(keyId)
					.keyUse(KeyUse.SIGNATURE)
					.algorithm(JWSAlgorithm.RS256)
					.generate();
		}
		catch (JOSEException impossible) {
			throw new IllegalStateException("No RSA on this JVM, which is not a state this suite can run in",
					impossible);
		}
	}

	private static void respond(HttpExchange exchange, String json) throws IOException {
		byte[] body = json.getBytes(UTF_8);
		exchange.getResponseHeaders().add("Content-Type", "application/json");
		exchange.sendResponseHeaders(200, body.length);
		try (OutputStream response = exchange.getResponseBody()) {
			response.write(body);
		}
	}

	private final RSAKey key;

	private final HttpServer server;

	/** Keycloak's own layout, so that what is proven here is proven against the URL shape the realm serves. */
	private static final String REALM_PATH = "/realms/" + KeycloakFromCompose.REALM;

	private static final String DISCOVERY_PATH = "/.well-known/openid-configuration";

	private static final String JWKS_PATH = "/protocol/openid-connect/certs";

}
