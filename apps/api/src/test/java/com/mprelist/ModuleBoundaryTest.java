package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

/**
 * The build-time boundary check ADR-0012 makes the point of this module layout: a module reaching into
 * another's internals fails the build rather than being caught in review, or not at all.
 */
class ModuleBoundaryTest {

	private static final ApplicationModules MODULES = ApplicationModules.of(ApiApplication.class);

	@Test
	void noModuleReachesIntoAnothersInternals() {
		MODULES.verify();
	}

	/**
	 * The check above passes, and a check that passes is indistinguishable from one that has stopped working
	 * until something is written for it to catch — which is not a thing to write on purpose in {@code main}.
	 * This points the same verification at a fixture built to be caught instead: a failure above means the
	 * layout is broken, a failure here means the check is.
	 *
	 * <p>Worth more since #20, not less. There are real inter-module references now — {@code subscription}
	 * reads {@code identity}'s {@code UserProvisioned} and {@code catalog}'s {@code TierCatalog} — so the
	 * check above has something to be right about, and this is what says it would notice one of them reaching
	 * a package deeper.
	 */
	@Test
	void andTheCheckAboveIsWhatWouldCatchOneThatDid() {
		assertThatThrownBy(() -> ApplicationModules.of("fixtures.boundary").verify())
				.hasMessageContaining("BetaService")
				.hasMessageContaining("AlphaInternals");
	}

	/**
	 * A module Modulith does not see is a module it does not check, and an empty package produces no class
	 * file to see. This is what would fail if a package-info lost its {@code @ApplicationModule}.
	 */
	@Test
	void allSixModulesAreVisibleToTheCheck() {
		assertThat(MODULES.stream().map(module -> module.getIdentifier().toString()))
				.containsExactlyInAnyOrder("identity", "catalog", "subscription", "enforcement", "display",
						"admin");
	}
}
