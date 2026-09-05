package com.mprelist.enforcement.internal;

import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * The body of {@code POST /api/relist/authorize}: {@code { "adId": "...", "batch": true }}, and nothing else.
 *
 * <p><strong>No {@code marktplaatsAccountId}</strong>, which ADR-0007's 2026-08-13 refinement removed along
 * with the {@code NOT_YOUR_ACCOUNT} denial it fed. Nothing in the extension can produce a Marktplaats account
 * identifier, and more fundamentally the backend could not verify one if it did — only the client can assert
 * which account a browser session belongs to, and under ADR-0007 the client is the adversary. Quota and pacing
 * are per user. An older extension build that still sends the field is not refused for it: unknown properties
 * are ignored, so the field it no longer needs to send is simply not read.
 *
 * @param adId the ad this authorization would be for, at {@link AdId} rather than as a bare string — which is
 * also where "an ad has to be named" is enforced, since that rule holds wherever one is built and not only on
 * the path in through here
 * @param batch whether this ad is one of several the caller is working through (#147, ADR-0025).
 * <strong>Stated rather than inferred, because nothing here could infer it</strong>: a batch reaches this
 * endpoint as N ordinary requests, one at a time, indistinguishable from a fast finger. What it buys is the
 * one refusal the popup cannot make for itself — a plan without {@code bulk} is turned away before it spends
 * anything.
 * <p>
 * A {@code boolean} rather than a {@code Boolean}, because <em>absent</em> and <em>false</em> are the same
 * request and a null would be a third state neither end of this contract has a word for. The
 * {@link JsonSetter} is what makes that true rather than merely intended: Jackson 3 refuses to map an absent
 * property onto a primitive by default ({@code FAIL_ON_NULL_FOR_PRIMITIVES}), so without it every body from
 * every build shipped before this ticket — which is all of them, for as long as a store review takes — would
 * come back a {@code 400}. Narrowed to this one field rather than turned off for the application, since a
 * missing number elsewhere really is a request that could not be read
 */
record AuthorizeRequest(AdId adId, @JsonSetter(nulls = Nulls.AS_EMPTY) boolean batch) {

	/**
	 * A body naming no {@code adId} at all is a request that could not be read rather than a caller to turn
	 * away, so it fails here and comes back as a {@code 400} carrying no reason code — the shape the contract
	 * reserves for a {@code 4xx} that is not a denial. A blank one fails the same way, one type further in.
	 */
	AuthorizeRequest {
		if (adId == null) {
			throw new IllegalArgumentException("An authorization is for one ad, so a request has to name it");
		}
	}

}
