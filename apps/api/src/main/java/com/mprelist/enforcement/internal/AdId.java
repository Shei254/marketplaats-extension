package com.mprelist.enforcement.internal;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * The ad an authorization is for: an identifier the extension already holds, opaque to us, and the whole of
 * what this backend ever learns about a listing (ADR-0001's boundary rule — no Marktplaats session or
 * credential crosses to us).
 *
 * <p>A type rather than a bare {@code String}, for {@link com.mprelist.catalog.TierId}'s reason. It travels
 * from the request body through the reservation to the signed token, and on that path it is one of several
 * strings in a row that the compiler would otherwise be happy to see swapped — {@code reserve(user, adId, …)}
 * takes an id and a status spelling side by side, and the token's claims are all strings. The compiler is the
 * cheapest thing that will ever notice.
 *
 * <p>It also gives the "not blank" rule one home. {@code ad_id} is {@code not null} but not {@code not blank},
 * and an authorization for an ad nobody named is one #23 could never match a report to — so it is refused
 * wherever an {@link AdId} is built rather than only on the path in through the request body.
 *
 * @param value the identifier as the extension sends it
 */
record AdId(String value) {

	/**
	 * A blank id makes this a request that could not be read rather than a caller to turn away, so it fails
	 * here and comes back as a {@code 400} carrying no reason code — the shape the contract reserves for a
	 * {@code 4xx} that is not a denial.
	 */
	AdId {
		if (value == null || value.isBlank()) {
			throw new IllegalArgumentException("An authorization is for one ad, so a request has to name it");
		}
	}

	/**
	 * Delegating, so the wire shape is unchanged: {@code "adId": "ad-1"} stays a JSON string rather than
	 * becoming an object wrapping one. {@link JsonValue} keeps that true in the other direction for whichever
	 * ticket first sends an ad id back out.
	 */
	@JsonCreator(mode = JsonCreator.Mode.DELEGATING)
	static AdId of(String value) {
		return new AdId(value);
	}

	@JsonValue
	@Override
	public String value() {
		return this.value;
	}

}
