package com.mprelist.billing;

/**
 * Creating a plan in Stripe from this side (on #84's screen) — the half
 * <a href="../../../../../../../docs/adr/0019-plans-are-stripe-first-and-webhook-synced.md">ADR-0019</a>
 * originally left to the dashboard.
 *
 * <p><strong>It creates and never edits</strong>, and that distinction is the whole of why this is compatible
 * with the decision it amends. ADR-0019 rejected a form that owned an amount because Stripe Prices are
 * immutable and "a form field labelled amount would be lying about what editing it does" — which is an
 * argument about editing. Creating one is honest: the amount is written once, into the system that owns it,
 * and is never editable here afterwards.
 *
 * <p><strong>What it deliberately does not do is write a tier.</strong> It creates a Product and, since
 * T66, a Price per rhythm the plan is sold at — each tagged with the tier code — and the row is then made by
 * {@code catalog}'s existing
 * {@link com.mprelist.catalog.PriceAdoptions} — the same call the webhook makes. So there is still exactly one
 * writer of the {@code tier} table's Stripe columns, and the {@code price.created} that Stripe sends moments
 * later is an idempotent no-op rather than a second opinion.
 */
public interface StripePlans {

	/**
	 * @param plan what the operator asked for
	 * @param idempotencyKey what makes a double-submitted form one Product rather than two. Stripe replays the
	 * first answer for a repeated key, so the same key must mean the same request and a different one must
	 * mean a different request — the caller derives it from what was asked for, not from a clock
	 * @return the Prices to adopt, or why Stripe would not make any of them
	 */
	PlanCreation create(NewPlanInStripe plan, String idempotencyKey);

}
