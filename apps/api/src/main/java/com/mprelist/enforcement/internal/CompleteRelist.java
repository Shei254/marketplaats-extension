package com.mprelist.enforcement.internal;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.mprelist.enforcement.RemainingQuota;
import com.mprelist.identity.UserRef;

/**
 * {@code POST /api/relist/complete} — what the extension says happened to the relist it was authorized for,
 * and the call that gives a unit back when nothing was consumed ({@code docs/enforcement-contract.md}).
 *
 * <p>{@link UserRef} for {@link AuthorizeRelist}'s reason and one of its own: the reservation being reported on
 * is resolved against the account that holds it, so the caller's own row is what makes a {@code jti} theirs to
 * resolve rather than merely a value they hold.
 */
@RestController
class CompleteRelist {

	CompleteRelist(RelistReports reports) {
		this.reports = reports;
	}

	/**
	 * {@code 200} with the quota as it now stands, or {@code 404} for a {@code jti} that names no reservation
	 * of this caller's.
	 *
	 * <p><strong>The {@code 404} carries no reason code</strong>, which is the contract's shape for a
	 * {@code 4xx} that is not a denial: this caller was not turned away, they named something that is not
	 * there. It is also the same answer for a reservation that never existed and for one belonging to somebody
	 * else, on purpose — a client that could tell those apart would have been handed a way to ask whether a
	 * given id is anybody's.
	 *
	 * <p>{@code consumes} is stated for {@link AuthorizeRelist}'s reason, so a caller posting something other
	 * than JSON is told {@code 415} rather than being read as a report of a relist nobody made.
	 */
	@PostMapping(path = "/api/relist/complete", consumes = MediaType.APPLICATION_JSON_VALUE)
	ResponseEntity<RemainingQuota> complete(UserRef caller, @RequestBody CompleteRequest report) {
		return this.reports.record(caller, report)
				.map(ResponseEntity::ok)
				.orElseGet(() -> ResponseEntity.notFound().build());
	}

	private final RelistReports reports;

}
