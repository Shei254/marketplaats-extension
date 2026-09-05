package com.mprelist.enforcement.internal;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.mprelist.identity.UserRef;

/**
 * {@code POST /api/relist/authorize} — the first route this application ships, and the one the extension calls
 * before it deletes anything (ADR-0007, {@code docs/enforcement-contract.md}).
 *
 * <p>The signature is the whole of what this layer decides. {@link UserRef} rather than
 * {@code CurrentUser} because the gate writes a reservation against an account, and asking for one is what
 * provisions it (#20) — so a first-ever request authorizes on a subscription created moments earlier rather
 * than failing on a user who has never been seen. No Spring Security type appears here at all: a call carrying
 * no token never reaches this method, because every route is closed until one arrives (#19).
 */
@RestController
class AuthorizeRelist {

	AuthorizeRelist(RelistGate gate) {
		this.gate = gate;
	}

	/**
	 * The verdict, served as the status its reason names — {@code 200} with the authorization, {@code 402} for a
	 * lapsed subscription, {@code 403} for a batch the plan does not include, {@code 429} for a spent quota.
	 *
	 * <p>The {@code switch} is exhaustive over a sealed type on purpose: a verdict this route had not been told
	 * how to answer would fail to compile rather than fall through to a status somebody chose in a hurry.
	 *
	 * <p>{@code consumes} is stated, so a caller that posts something other than JSON is told
	 * {@code 415 Unsupported Media Type} — a request this API could not read rather than a caller it turned
	 * away, and so carrying no reason code, which is exactly what the contract says a non-denial {@code 4xx}
	 * looks like.
	 */
	@PostMapping(path = "/api/relist/authorize", consumes = MediaType.APPLICATION_JSON_VALUE)
	ResponseEntity<Verdict> authorize(UserRef caller, @RequestBody AuthorizeRequest request) {
		return switch (this.gate.authorize(caller, request.adId(), request.batch())) {
			case Verdict.RelistAuthorization granted -> ResponseEntity.ok(granted);
			case Verdict.Refused refused -> ResponseEntity.status(refused.reason().status()).body(refused);
		};
	}

	private final RelistGate gate;

}
