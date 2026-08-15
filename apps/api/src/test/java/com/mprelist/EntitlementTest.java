package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.mprelist.catalog.Entitlement;

/**
 * The guards on the type itself, which are the schema's check constraints stated a second time — and the
 * second statement is the point. {@code TierEntitlementTest} covers what the {@code tier} table can produce;
 * this covers what a caller can construct, and #22's gate will construct plenty of them, since an entitlement
 * is the natural stand-in for "a user on a generous plan" in a test that has no catalog at all.
 *
 * <p>No Spring and no database: a value object's invariants are the one thing in this application that needs
 * neither.
 */
class EntitlementTest {

	/**
	 * The floor V1 sets, and it is zero rather than one: a tier granting no relists is a coherent thing to
	 * sell — a paused plan, or a catalog rung that exists only to be upgraded from — and the gate denies it
	 * with {@code QUOTA_EXCEEDED} like any other exhausted user rather than needing a case of its own.
	 */
	@Test
	void aTierMayGrantNoRelistsAtAll() {
		assertThatCode(() -> new Entitlement(0, 1, Map.of())).doesNotThrowAnyException();
	}

	/** Below it is not a smaller grant but an unwriteable row, so it is refused where it is built. */
	@Test
	void butNotFewerThanNone() {
		assertThatThrownBy(() -> new Entitlement(-1, 1, Map.of())).isInstanceOf(IllegalArgumentException.class);
	}

	/**
	 * And one Marktplaats account is the floor, not zero: a user who may associate none could relist nothing
	 * at all, which is a way of selling a tier that denies everything by arithmetic instead of by quota.
	 */
	@Test
	void andItGrantsAtLeastOneMarktplaatsAccount() {
		assertThatThrownBy(() -> new Entitlement(3, 0, Map.of())).isInstanceOf(IllegalArgumentException.class);
	}

	/**
	 * Flags are copied on the way in, so an entitlement cannot change under a reader who is already holding
	 * it — which is what would happen if the catalog ever cached one and handed the same map out twice.
	 */
	@Test
	void theFlagsAreCopiedRatherThanShared() {
		Map<String, Object> flags = new HashMap<>(Map.of("bulk", true));

		Entitlement entitlement = new Entitlement(50, 1, flags);
		flags.put("scheduling", true);

		assertThat(entitlement.features()).containsOnlyKeys("bulk");
	}

	@Test
	void andCannotBeEditedThroughTheEntitlementEither() {
		Entitlement entitlement = new Entitlement(50, 1, Map.of("bulk", true));

		assertThatThrownBy(() -> entitlement.features().put("scheduling", true))
				.isInstanceOf(UnsupportedOperationException.class);
	}

	/** {@code tier.features} is {@code not null} and defaults to {@code {}}; no tier grants a null. */
	@Test
	void andAreNeverNull() {
		assertThatThrownBy(() -> new Entitlement(3, 1, null)).isInstanceOf(IllegalArgumentException.class);
	}

}
