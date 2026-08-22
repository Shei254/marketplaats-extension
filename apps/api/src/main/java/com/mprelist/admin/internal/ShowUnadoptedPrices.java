package com.mprelist.admin.internal;

import java.util.List;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.mprelist.billing.UnadoptedPrices;
import com.mprelist.billing.UntaggedPrice;

/**
 * {@code GET /api/admin/prices} — what is in Stripe that this catalog has never heard of (T53, #84).
 *
 * <p><strong>It exists to make one silent failure loud.</strong> ADR-0019 names it as the cost of tagging:
 * "a missing tag is silent — the Price exists, nothing appears in {@code /admin}, and the only symptom is
 * absence." An operator who creates a Price and forgets {@code metadata.tier_code} gets a plan screen without
 * their plan on it and no error anywhere. This route is the place that absence is visible.
 *
 * <p><strong>It lists, and does nothing.</strong> There is no button here to adopt one, on purpose: Stripe
 * accounts hold Prices for one-offs, coupons and experiments, and a sync that adopted them all is exactly what
 * ADR-0019 refuses. The operator is the one who can tell an experiment from a forgotten tag, and the way to
 * adopt is to add the tag in Stripe — which fires {@code price.updated} and lets the sync (T51, #82) do it
 * through the one path that already exists.
 *
 * <p><strong>{@code 503} rather than an empty list when Stripe cannot be asked</strong>, which is the same
 * distinction {@code GET /api/plans} draws and matters more here: an empty list is the *good* state — every
 * Price is tagged — so reporting an outage as one would tell an operator their catalog is complete at exactly
 * the moment nobody can check.
 */
@RestController
class ShowUnadoptedPrices {

	ShowUnadoptedPrices(UnadoptedPrices prices) {
		this.prices = prices;
	}

	@GetMapping(path = PATH)
	ResponseEntity<UnadoptedPricesOnTheWire> unadopted() {
		return this.prices.untagged()
				.map(untagged -> ResponseEntity.ok(new UnadoptedPricesOnTheWire(untagged)))
				.orElseGet(() -> ResponseEntity.status(503).build());
	}

	/**
	 * An object rather than a bare array, like every other list this API answers with — a body that is an
	 * array cannot grow a field without breaking every reader of it.
	 */
	record UnadoptedPricesOnTheWire(List<UntaggedPrice> prices) {
	}

	private final UnadoptedPrices prices;

	static final String PATH = "/api/admin/prices";

}
