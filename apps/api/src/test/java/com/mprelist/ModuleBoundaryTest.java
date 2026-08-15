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
	 * No module references another at all today, so the check above cannot fail for the right reason yet — and
	 * a check that cannot fail is indistinguishable from one that has stopped working. This points the same
	 * verification at a fixture built to be caught: a failure above means the layout is broken, a failure
	 * here means the check is.
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
	void allFiveModulesAreVisibleToTheCheck() {
		assertThat(MODULES.stream().map(module -> module.getIdentifier().toString()))
				.containsExactlyInAnyOrder("identity", "catalog", "subscription", "enforcement", "admin");
	}
}
