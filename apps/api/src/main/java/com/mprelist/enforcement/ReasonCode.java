package com.mprelist.enforcement;

import org.springframework.http.HttpStatus;

/**
 * The typed reason codes {@code docs/enforcement-contract.md} denies with, and the status each is served as.
 * The extension's gate (#34) reads the code and never the prose, which is what lets a denial change its
 * wording without changing what a client does about it.
 *
 * <p>The mapping lives on the code rather than at the point of refusal, so that "quota exhausted is a 429" is
 * stated once. Nothing else in this application decides a denial's status.
 *
 * <p>Five of the contract's six are here. {@code UNAUTHENTICATED} is {@code identity}'s — it is answered by
 * the filter chain before any route is reached, which is what makes it true of routes no ticket has written
 * yet (#19).
 *
 * <p><strong>Public since T77, and it was in {@code internal} until then</strong>
 * (<a href="../../../../../../../docs/adr/0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md">ADR-0032</a>).
 * Every code here used to be sent by one module, on the two routes the gate owns, so the enum could be as
 * private as the decision it belongs to. {@link #NO_TIER} is the first that travels on somebody else's route:
 * it is answered by {@code GET /api/me} as well as by {@code /authorize}, and that second half is the whole
 * reason it exists as a code rather than as a {@code 503}. Publishing the enum is what keeps the vocabulary
 * single-sourced — {@code packages/contracts} holds its own list to this file, and a second spelling of
 * {@code "NO_TIER"} in {@code display} would be a string nothing compares to anything.
 *
 * <p>{@link #BULK_NOT_ENTITLED} was declared here, in the contract and in {@code packages/contracts} before
 * anything could send it, so that no installed build would meet a code it had never heard of and render it as
 * "something went wrong, try again" at somebody who could have fixed it in a click. Since #147
 * {@code /authorize} accepts the {@code batch} flag that is refused with it, and the ordering has paid for
 * itself: the clients that shipped before this deploy already know what it means.
 */
public enum ReasonCode {

	/**
	 * A payer whose subscription lapsed, and only ever that. Every user always has a subscription and a free
	 * one is {@code active} (ADR-0014), so a user who has never paid is denied by {@link #QUOTA_EXCEEDED} —
	 * this code means the plan stopped, which is why the extension renders it as an upsell rather than an
	 * upgrade prompt.
	 *
	 * <p>{@code 402}, which is the contract's choice: it is the status the extension's gate switches on to show
	 * "your payment lapsed" without reading the body twice.
	 */
	SUBSCRIPTION_INACTIVE(HttpStatus.PAYMENT_REQUIRED),

	/**
	 * A caller asked for a capability their plan does not include — today, a {@code batch} on
	 * {@code /authorize} from an Entitlement carrying no {@code bulk} flag (ADR-0025, #147).
	 *
	 * <p><strong>Checked above {@link #QUOTA_EXCEEDED} and below the subscription status</strong>, which is the
	 * whole reason it is a code rather than a reuse of one. Both send the user to the same plan screen and only
	 * one of them describes what was asked for: answering "you are out of relists" to somebody who asked for a
	 * feature they do not have describes a second thing they also do not have, and neither sentence is the one
	 * they need.
	 *
	 * <p>{@code 403} rather than a {@code 429}: the caller is authenticated and simply not permitted, and no
	 * amount of waiting changes it. It is told apart from the {@code 403} the resource server already answers an
	 * ADMIN-less caller with by the rule the contract's denial shape states — <em>the presence of
	 * {@code reason} means the gate turned you away</em>. That one carries no body, and this one does.
	 *
	 * <p><strong>How many at once is not this code's business.</strong> {@code features.bulk} carries
	 * {@code {"upTo": N}} and nothing here can count a selection, because a batch arrives one ad at a time. The
	 * API says <em>whether</em>, and the popup says <em>how many</em>.
	 */
	BULK_NOT_ENTITLED(HttpStatus.FORBIDDEN),

	/**
	 * The relists this period are spent. Carries {@code resetAt} — the end of the window — because "you have
	 * used your 3" is only actionable beside "and they come back on the 14th", and it is a free user's ordinary
	 * denial rather than an error.
	 *
	 * <p>{@code 429} rather than {@code 403}: the request is one the caller may make again, just not yet.
	 */
	QUOTA_EXCEEDED(HttpStatus.TOO_MANY_REQUESTS),

	/**
	 * Too fast (#25, ADR-0008). Carries {@code retryAfter} — how many seconds until the caller may relist
	 * again — because a cooldown a user cannot see the end of is indistinguishable from something broken, and
	 * the extension renders it as a timer rather than as an error.
	 *
	 * <p>{@code 429} beside {@link #QUOTA_EXCEEDED}, and the two are told apart by the code rather than by the
	 * status: they are the same statement about HTTP — come back later — and different statements about the
	 * user, one of whom needs a bigger plan and the other of whom needs a minute. Which is exactly why the
	 * contract's denials carry a typed code at all.
	 */
	RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS),

	/**
	 * The caller's subscription names no tier, so there is nothing to read a plan, a grant or a reset date out
	 * of (T77, ADR-0032).
	 *
	 * <p>Reachable exactly one way: an operator deleted the tier this person was on and the catalog had no
	 * default to move them to — the default tier itself, or the last tier there is. Their subscription row
	 * survives, with their {@code stripe_customer_id} and the anchor every future window is rolled from, and
	 * one {@code PUT /api/admin/tiers/{code}/default} adopts them and everybody like them at once.
	 *
	 * <p><strong>Checked above the subscription status, and that ordering is the contract's.</strong> Every
	 * check below it reads the tier — the quota is the tier's grant, {@code bulk} is one of its flags — so
	 * there is nothing for them to read and no honest answer for them to give. Status is the interesting one:
	 * a mirrored status is still perfectly true of a tier-less subscriber, and answering
	 * {@link #SUBSCRIPTION_INACTIVE} would tell somebody their card is failing when what happened is that
	 * their plan was deleted. That is the one denial in this contract that would point at the wrong person.
	 *
	 * <p><strong>{@code 403} and not a {@code 503}</strong>, which was argued and is the cost this code was
	 * added to pay. The empty-bodied {@code 503} {@code GET /api/plans} answers when Stripe cannot be reached
	 * is the nearest precedent — the rule being that the codes are statements about the <em>user</em> and that
	 * one is about our ability to answer at all — and an emptied catalog arguably qualifies. It was rejected
	 * because the sentence a client renders for a {@code 503} is "unavailable, retry", and no retry fixes
	 * this: an operator may sit in an emptied catalog deliberately. It carries no field for
	 * {@link #BULK_NOT_ENTITLED}'s reason, and a stronger one — what to do about it is not the user's to do.
	 *
	 * <p><strong>And it is {@code NO_TIER} rather than {@code NO_PLAN}.</strong> ADR-0019 split those two
	 * words and {@code docs/glossary.md} keeps them apart: a Plan is a Tier joined with its Stripe Prices, so
	 * a free user has a Tier and has never had a Plan — {@code NO_PLAN} would be true of them on a good day.
	 * {@code TIER_WITHDRAWN} was the other candidate and would have been the one code here describing an
	 * event rather than a condition.
	 */
	NO_TIER(HttpStatus.FORBIDDEN);

	public HttpStatus status() {
		return this.status;
	}

	ReasonCode(HttpStatus status) {
		this.status = status;
	}

	private final HttpStatus status;

}
