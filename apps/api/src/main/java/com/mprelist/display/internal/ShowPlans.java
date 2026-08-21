package com.mprelist.display.internal;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /api/plans} — what can be bought (T49, #80, {@code docs/enforcement-contract.md}).
 *
 * <p><strong>Authenticated, though nothing about it is per-user.</strong> The API is closed by default and
 * there is no reason to open one route: the caller is the popup, which holds an access token already because
 * it has just rendered {@code /api/me}, and a public plans endpoint would be one more surface to reason about
 * for no gain (ADR-0017 — {@code apps/web} has no login and never calls this).
 *
 * <p><strong>It grants nothing and spends nothing</strong>, like {@code /api/me} beside it. That is what lets
 * it call Stripe at all: ADR-0014's rule is that {@code authorize} never does, and this route is not on that
 * path.
 *
 * <p><strong>{@code 503} with an empty body when a price could not be had.</strong> Not a denial and so no
 * {@code reason} — the contract's codes are statements about the user, and this is a statement about our
 * ability to answer at all — which is the same rule every other non-denial refusal here follows. The client
 * renders "prices unavailable, retry"; what it must never do is show a free plan or an amount we guessed, so
 * this must never be a {@code 200} with an empty list. An empty list means something else and is answered
 * {@code 200}: nothing is on sale.
 */
@RestController
class ShowPlans {

	ShowPlans(PlansOnOffer offer) {
		this.offer = offer;
	}

	@GetMapping("/api/plans")
	ResponseEntity<PlansOnOffer.Plans> plans() {
		return this.offer.cards()
				.map(ResponseEntity::ok)
				.orElseGet(() -> ResponseEntity.status(503).build());
	}

	private final PlansOnOffer offer;

}
