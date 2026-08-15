package com.mprelist.enforcement.internal;

import java.util.UUID;

/**
 * The body of {@code POST /api/relist/complete}: {@code { "jti": "...", "outcome": "..." }}, which is the
 * authorization being reported on and what became of it.
 *
 * <p><strong>No {@code authToken}.</strong> The {@code jti} is the reservation's own id (#22), so this backend
 * resolves a row in its own table rather than reading a claim out of a token it signed — which is why nothing
 * here verifies a signature, and why the signing key of {@code RelistAuthorizations} is still generated per
 * process. Handing the whole token back would buy one thing this does not need: proof that the caller was the
 * one it was issued to. That is already answered, better, by the caller's own access token, since a
 * reservation is resolved only against the account that holds it.
 *
 * @param jti the reservation to resolve, as {@code /authorize} named it. A {@link UUID}, so a value shaped
 * like anything else is a request that could not be read rather than a reservation that could not be found —
 * the two are told apart before either reaches the database
 * @param outcome what happened, at {@link RelistOutcome} rather than as a string. An outcome the contract does
 * not name fails on the way in, for {@link AdId}'s reason: a spelling nobody checked would otherwise reach the
 * {@code relist_event} check constraint as a {@code 500}, at the end of a relist the user has already performed
 */
record CompleteRequest(UUID jti, RelistOutcome outcome) {

	/**
	 * A body missing either half is a request that could not be read rather than a caller to turn away, so it
	 * fails here and comes back as a {@code 400} carrying no reason code — the shape the contract reserves for
	 * a {@code 4xx} that is not a denial.
	 *
	 * <p>Neither has a default worth guessing at. A missing {@code jti} names no reservation, and a missing
	 * outcome would have to be read as a success — which settles a unit for a relist nobody said happened.
	 */
	CompleteRequest {
		if (jti == null) {
			throw new IllegalArgumentException("A report is about one authorization, so it has to name the jti "
					+ "that authorization carried");
		}
		if (outcome == null) {
			throw new IllegalArgumentException("A report says what happened, and there is no outcome to assume "
					+ "for one that does not: an unreported relist is #24's to reconcile, not this call's to "
					+ "guess at");
		}
	}

}
