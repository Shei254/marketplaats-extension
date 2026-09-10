package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;

import com.mprelist.catalog.TierEdit;

/**
 * "Grants nothing", as the three layers of the publish rule all have to agree it is spelled (T73, ADR-0029).
 *
 * <p>The rule itself is exercised where it bites — {@code AdminTierTest} on the {@code PUT},
 * {@code CreatePlanTest} on the {@code POST}, and {@code BaselineSchemaTest} against V9's trigger. What is
 * here is the predicate underneath those three, because a quota is now three states and the answer differs
 * for each: this is the one place all three are asked in a row. No Spring and no database.
 */
class TierGrantTest {

	/** Exactly zero. It is a number an operator typed, and it means a period grants no reposts. */
	@Test
	void aQuotaOfZeroGrantsNothing() {
		assertThat(TierEdit.grantsNothing(0)).isTrue();
		assertThat(edit(0).grantsNothing()).isTrue();
	}

	/**
	 * The state the whole ADR exists for. Unlimited is the <em>most</em> generous tier there is, and an
	 * {@code Integer} comparison written with {@code ==} or an unboxing {@code equals} is how it would come
	 * to be read as the least — which is the failure mode ADR-0029 rejected {@code -1} to avoid, arriving
	 * through {@code null} instead.
	 */
	@Test
	void butUnlimitedGrantsEverything() {
		assertThat(TierEdit.grantsNothing(null)).isFalse();
		assertThat(edit(null).grantsNothing()).isFalse();
	}

	/** And any cap at all is something. */
	@Test
	void andACapIsSomethingHowerverSmall() {
		assertThat(TierEdit.grantsNothing(1)).isFalse();
		assertThat(edit(50).grantsNothing()).isFalse();
	}

	/**
	 * The instance form answers only about the grant, not about whether the tier is on sale. The publish
	 * rule is {@code published && grantsNothing()}, and it is written that way at all three call sites: a
	 * predicate that folded {@code published} in would read as a rule about what {@code 0} means, when it is
	 * a rule about publishing (see {@code TierEdited.NothingToGrant}).
	 */
	@Test
	void andSaysNothingAboutWhetherItIsOnSale() {
		assertThat(edit(0).grantsNothing()).isTrue();
		assertThat(new TierEdit("Draft", 0, Map.of(), false).grantsNothing()).isTrue();
	}

	private static TierEdit edit(Integer quota) {
		return new TierEdit("Pro", quota, Map.of(), true);
	}

}
