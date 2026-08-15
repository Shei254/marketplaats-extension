package com.mprelist.identity;

/**
 * Who the request being handled is from, as the access token says it — and nothing else. A controller in any
 * module takes one as a parameter and gets the caller the token was validated for; there is no way to ask for
 * a caller who was not authenticated, because the resolver behind this refuses rather than inventing one.
 *
 * <p>It carries the IdP's subject rather than a row of ours, and it is named for the role rather than for
 * Keycloak, for the reason {@code app_user.idp_subject} is (ADR-0009 wants the IdP replaceable, and the
 * cheapest way to make it permanent is to spell the vendor into everything that touches it). {@link UserRef}
 * — the other half of this module's public API in ADR-0012 — is the account behind that subject, and a
 * handler that has to store something asks for it instead. Declaring this one touches no database at all.
 *
 * <p>The token's realm roles are deliberately <em>not</em> a field here. They become Spring Security
 * authorities instead, because the only thing that reads them is a declarative guard on a route
 * ({@code hasRole('ADMIN')}, #27), and a second copy on this record would be a second thing that can
 * disagree with the one the guard actually consults.
 *
 * @param idpSubject the {@code sub} claim of the validated access token: stable for the life of the account,
 *                   and the key {@code app_user} is found by
 */
public record CurrentUser(String idpSubject) {

	public CurrentUser {
		if (idpSubject == null || idpSubject.isBlank()) {
			throw new IllegalArgumentException("A caller with no subject is not one this API can name");
		}
	}

}
