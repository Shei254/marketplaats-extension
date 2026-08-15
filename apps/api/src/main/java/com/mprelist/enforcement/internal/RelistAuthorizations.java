package com.mprelist.enforcement.internal;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;

import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.stereotype.Service;

import com.mprelist.identity.UserRef;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;

/**
 * Where a verdict becomes something the extension can hold: the signed, short-lived authorization of ADR-0007.
 *
 * <p>Signed because the alternative is a client that decides for itself whether it was authorized, which under
 * ADR-0007 is the adversary. Short-lived and one-per-reservation because that is what makes a stockpile
 * worthless: pre-fetching a hundred authorizations while subscribed spends a hundred quota units and leaves a
 * hundred tokens that are dead in under a minute.
 */
@Service
class RelistAuthorizations {

	/**
	 * About 45 seconds, which {@code docs/enforcement-contract.md} fixes. Long enough for a delete and a create
	 * against Marktplaats, short enough that a cancelled subscriber's last grant is worthless before they have
	 * read the denial that replaced it. The same instant is written to the reservation's {@code expires_at}, so
	 * #24 looks for abandoned reservations by the expiry of the token that was issued against them rather than
	 * by a second rule that could drift from this one.
	 */
	static final Duration LIFETIME = Duration.ofSeconds(45);

	RelistAuthorizations() {
		this.tokens = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(signingKey())));
	}

	/**
	 * The four claims the contract names and no others: who it is for, what it authorizes, which reservation it
	 * spent, and when it stops being valid.
	 *
	 * <p>{@code sub} is our own {@code app_user} id rather than the IdP subject the caller's own token carries.
	 * We are the only reader this token will ever have — {@code /complete} resolves the reservation the
	 * {@code jti} names — and the reservation, like every other row in the schema, is keyed by our id. Putting
	 * Keycloak's name for the caller in a token of ours would be spelling the identity provider into a second
	 * place ADR-0009 then has to rewrite.
	 *
	 * <p>{@code jti} is the reservation id rather than a nonce of its own, which is what makes the token
	 * single-use without a second table to burn it in: #23 settles the reservation the {@code jti} names, and
	 * {@code relist_event.reservation_id} is unique, so a second report for one authorization collides in the
	 * database rather than depending on this service to have remembered it.
	 */
	Verdict.RelistAuthorization issue(UserRef caller, AdId adId, UUID reservation, OffsetDateTime expiresAt) {
		JwtClaimsSet claims = JwtClaimsSet.builder()
				.subject(caller.id().toString())
				.claim("adId", adId.value())
				.id(reservation.toString())
				.expiresAt(expiresAt.toInstant())
				.build();
		String token = this.tokens
				.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).build(), claims))
				.getTokenValue();
		return new Verdict.RelistAuthorization(token, expiresAt, reservation);
	}

	/**
	 * An RSA key pair generated at startup and held in memory, which is a smaller promise than the "backend-held
	 * asymmetric key, rotated" {@code docs/enforcement-contract.md} settles on, and deliberately so.
	 *
	 * <p><strong>Nothing verifies one of these yet.</strong> {@code /complete} takes a {@code jti} and resolves
	 * the reservation it names in our own table (#23), so the signature is what makes the token unforgeable
	 * <em>if</em> it is ever checked, and today no code path checks it. A configured key would therefore be a
	 * secret to generate, distribute and rotate in every environment before anything read it — and a
	 * hardcoded development default would be the one that eventually ships.
	 *
	 * <p>What that costs is stated rather than discovered: a restart invalidates every authorization still in
	 * flight, which is at most 45 seconds of them, and <strong>a second instance of this application would sign
	 * with a second key</strong>. Neither is observable while nothing verifies, and both stop being acceptable
	 * on the day something does — so the first verifier is what turns this into configuration, and it is named
	 * as such in {@code apps/api/README.md} and in the backlog rather than left as a surprise for whoever
	 * deploys a second instance.
	 */
	private static RSAKey signingKey() {
		try {
			return new RSAKeyGenerator(2048)
					.keyID(UUID.randomUUID().toString())
					.keyUse(KeyUse.SIGNATURE)
					.algorithm(JWSAlgorithm.RS256)
					.generate();
		}
		catch (JOSEException impossible) {
			throw new IllegalStateException("No RSA on this JVM, so no relist can be authorized at all", impossible);
		}
	}

	private final JwtEncoder tokens;

}
