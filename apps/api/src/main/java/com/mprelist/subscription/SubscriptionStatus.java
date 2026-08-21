package com.mprelist.subscription;

/**
 * Stripe's view of a subscription, normalized to the seven values {@code V1__baseline_schema.sql} allows in
 * the {@code status} column and {@code docs/enforcement-contract.md} names. Stripe is authoritative for status
 * and lifecycle (ADR-0006); this is the mirror those webhooks (#30) write into, and the only thing the
 * authorize path reads — no Stripe call on the hot path.
 *
 * <p>An enum here and a {@code text} column with a check constraint there, which is the pairing ADR-0012 wants
 * either way round: Stripe adds statuses, so widening a check constraint is one migration line where widening
 * a Postgres enum type is a lock and narrowing one is not possible at all. What that costs is the mapping in
 * {@code internal}, which is the adapter's job and nobody else's.
 */
public enum SubscriptionStatus {

	/** Paid up, or on the free tier — first login provisions onto the default tier with this (#20). */
	ACTIVE(true),

	/**
	 * In a Stripe trial, which ADR-0006 puts on the Price rather than in our code. Allowed for the same reason
	 * {@link #ACTIVE} is and with no special case anywhere: a trial the user is inside of is a subscription
	 * that entitles them, and the day it lapses Stripe says so with one of the six below.
	 */
	TRIALING(true),

	PAST_DUE(false),
	CANCELED(false),
	UNPAID(false),
	INCOMPLETE(false),
	INCOMPLETE_EXPIRED(false);

	/**
	 * Whether a subscription in this state entitles its holder to anything at all — the first of the gate's
	 * checks after the token, and the one that answers {@code 402 SUBSCRIPTION_INACTIVE} (#22).
	 *
	 * <p>Asked of the status rather than listed at each caller, so that "allowed means active or trialing" has
	 * one home. It says nothing about quota: a subscriber this returns {@code true} for may still have spent
	 * every relist in their period, which is a different denial with a different code and a {@code resetAt} the
	 * lapsed payer above has no use for.
	 *
	 * <p>Never a proxy for "is this user paying". Every user always has a subscription (ADR-0014) and a free one
	 * is {@code ACTIVE}, so this is true of everybody who has not lapsed — and {@code SUBSCRIPTION_INACTIVE} can
	 * therefore only ever mean a payer whose subscription stopped, never somebody who has not signed up.
	 */
	public boolean allowsRelisting() {
		return this.allowsRelisting;
	}

	/**
	 * Whether Stripe is finished with this subscription: it is over, and no retry of theirs is going to
	 * revive it. The two that are — {@code canceled} and {@code incomplete_expired} — are what ADR-0018 calls
	 * a terminal end, and what {@code SubscriptionMirror.ended} turns back into a free user (#30, T20).
	 *
	 * <p><strong>Dunning is not an end</strong>, which is the distinction this method exists to hold.
	 * {@code past_due}, {@code unpaid} and {@code incomplete} are a card being retried: the customer still
	 * believes they are a subscriber, Stripe still believes it can charge them, and a successful retry gives
	 * the tier straight back. Dropping them to free mid-retry would take away something the next event
	 * returns — and is why {@code SUBSCRIPTION_INACTIVE} means a failing card and nothing else.
	 *
	 * <p>A switch over every constant rather than two equality checks, so that Stripe adding a status is a
	 * compilation failure here — where somebody has to decide which side of the line it falls on — rather than
	 * a silent {@code false} that keeps a dead subscription on a paid tier.
	 */
	public boolean endsTheSubscription() {
		return switch (this) {
			case CANCELED, INCOMPLETE_EXPIRED -> true;
			case ACTIVE, TRIALING, PAST_DUE, UNPAID, INCOMPLETE -> false;
		};
	}

	SubscriptionStatus(boolean allowsRelisting) {
		this.allowsRelisting = allowsRelisting;
	}

	private final boolean allowsRelisting;

}
