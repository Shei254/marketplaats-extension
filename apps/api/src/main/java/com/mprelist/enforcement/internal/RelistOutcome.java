package com.mprelist.enforcement.internal;

/**
 * What the extension reports a relist turned out to be, and the three values {@code relist_event.outcome}
 * holds — {@code docs/enforcement-contract.md}'s {@code /complete} body, and the whole of what this backend
 * ever learns about a relist it authorized.
 *
 * <p><strong>The three are two questions, not one.</strong> Whether the relist worked is what the outcome mix
 * says — it is the breakage canary, and a rising {@link #FAILED_BEFORE_DELETE} rate is the signal that
 * Marktplaats moved something (ADR-0013's remote-config hotfix is what answers it). Whether the <em>unit</em>
 * is spent is a different question with a different answer, and it is the one below: what matters to quota is
 * whether the ad was deleted, because that is the destructive half a user cannot undo.
 *
 * <p>The mapping is on the outcome rather than at the point of settlement, for {@link ReasonCode}'s reason: a
 * fourth outcome added by a later contract would then have to answer this question where it is declared, and
 * cannot inherit whichever branch a {@code switch} happened to fall into.
 */
enum RelistOutcome {

	/** The ad was deleted and posted again. The unit is spent, which is what the user got for it. */
	SUCCESS(ReservationStatus.SETTLED),

	/**
	 * The relist failed with the ad still up: nothing was consumed on Marktplaats, so nothing is consumed
	 * here either. The refund is the reason {@code /complete} exists at all beyond telemetry — counting at
	 * authorize alone would charge a free user one of three relists for a call that never touched the site.
	 */
	FAILED_BEFORE_DELETE(ReservationStatus.REFUNDED),

	/**
	 * The ad was deleted and the re-post did not land, which is the worst thing that can happen to a user and
	 * still costs them the unit. Not a refund: the destructive action happened, and a quota that gave the unit
	 * back would let a broken relist loop burn a user's listings for free (ADR-0003's delete-first flow is
	 * what makes this state reachable, and its durable snapshot is what recovers from it).
	 */
	FAILED_AFTER_DELETE(ReservationStatus.SETTLED);

	/** What the reservation this was reported against becomes. */
	ReservationStatus resolvesTo() {
		return this.resolvesTo;
	}

	RelistOutcome(ReservationStatus resolvesTo) {
		this.resolvesTo = resolvesTo;
	}

	private final ReservationStatus resolvesTo;

}
