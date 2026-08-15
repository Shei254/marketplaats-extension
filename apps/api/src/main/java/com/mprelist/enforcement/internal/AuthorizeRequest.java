package com.mprelist.enforcement.internal;

/**
 * The body of {@code POST /api/relist/authorize}: {@code { "adId": "..." }}, and nothing else.
 *
 * <p><strong>No {@code marktplaatsAccountId}</strong>, which ADR-0007's 2026-08-13 refinement removed along
 * with the {@code NOT_YOUR_ACCOUNT} denial it fed. Nothing in the extension can produce a Marktplaats account
 * identifier, and more fundamentally the backend could not verify one if it did — only the client can assert
 * which account a browser session belongs to, and under ADR-0007 the client is the adversary. Quota and pacing
 * are per user. An older extension build that still sends the field is not refused for it: unknown properties
 * are ignored, so the field it no longer needs to send is simply not read.
 *
 * @param adId the ad this authorization would be for. It reaches the reservation and the signed token and is
 * otherwise opaque to us — an identifier the extension already holds, and the whole of what the backend learns
 * about a listing (ADR-0001's boundary rule: no Marktplaats session or credential ever crosses to us)
 */
record AuthorizeRequest(String adId) {

	/**
	 * A missing or empty {@code adId} makes this a request that could not be read rather than a caller to turn
	 * away, so it fails here and comes back as a {@code 400} carrying no reason code — the shape the contract
	 * reserves for a {@code 4xx} that is not a denial. Guarded rather than left to the column: {@code ad_id} is
	 * {@code not null} but not {@code not blank}, and an authorization for an ad nobody named is one #23 could
	 * never match a report to.
	 */
	AuthorizeRequest {
		if (adId == null || adId.isBlank()) {
			throw new IllegalArgumentException("An authorization is for one ad, so a request has to name it");
		}
	}

}
