package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.OffsetDateTime;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.mprelist.catalog.Entitlement;
import com.mprelist.enforcement.RemainingQuota;
import com.mprelist.subscription.QuotaPeriod;

/**
 * The subtraction three readers share, and what it answers on a tier with nothing to subtract from
 * (ADR-0029).
 *
 * <p>The arithmetic of a capped tier is exercised end to end by {@code RelistAuthorizationTest} and
 * {@code RelistCompletionTest} against a real catalog; what is here is the unlimited case, which is the one
 * that has no number to assert on a wire and so is easiest to get quietly wrong. No Spring and no database:
 * this is a value type's own rule.
 */
class RemainingQuotaTest {

	/**
	 * The point of the whole sentinel. A capped tier subtracts; an unlimited one has nothing to subtract
	 * from, so it answers {@code null} — and {@link RemainingQuota#isSpent()} is false whatever has been
	 * held, which is what makes the gate never refuse.
	 */
	@Test
	void anUnlimitedTierIsNeverSpent() {
		RemainingQuota left = RemainingQuota.of(new Entitlement(null, 1, Map.of()), 500, PERIOD);

		assertThat(left.quotaRemaining()).isNull();
		assertThat(left.isSpent()).isFalse();
		assertThat(left.resetAt()).isEqualTo(PERIOD.end());
	}

	/** A capped tier subtracts what the window holds, and stops at zero rather than going below it. */
	@Test
	void aCappedTierSubtractsAndClampsAtZero() {
		assertThat(RemainingQuota.of(new Entitlement(3, 1, Map.of()), 1, PERIOD).quotaRemaining()).isEqualTo(2);
		assertThat(RemainingQuota.of(new Entitlement(3, 1, Map.of()), 9, PERIOD).quotaRemaining()).isZero();
	}

	/**
	 * A tier granting nothing is spent from the start, which is what keeps "there is no free tier"
	 * (ADR-0019) one code path rather than a case of its own.
	 */
	@Test
	void aTierGrantingNothingIsSpentBeforeAnythingIsHeld() {
		RemainingQuota left = RemainingQuota.of(new Entitlement(0, 1, Map.of()), 0, PERIOD);

		assertThat(left.quotaRemaining()).isZero();
		assertThat(left.isSpent()).isTrue();
	}

	private static final QuotaPeriod PERIOD = new QuotaPeriod(OffsetDateTime.parse("2026-09-01T00:00:00Z"),
			OffsetDateTime.parse("2026-10-01T00:00:00Z"));

}
