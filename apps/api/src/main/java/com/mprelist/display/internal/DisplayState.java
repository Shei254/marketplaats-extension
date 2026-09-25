package com.mprelist.display.internal;

import java.time.OffsetDateTime;
import java.util.Map;

import com.mprelist.catalog.TierName;
import com.mprelist.subscription.SubscriptionStatus;

/**
 * The body of {@code GET /api/me}: the fields {@code docs/enforcement-contract.md} names, serialized as
 * this record stands.
 *
 * <p>One type rather than a domain answer plus a response mapped from it, for {@code Verdict}'s reason: the
 * two would be the same five fields, and the mapping between them is where a field silently stops being sent.
 *
 * <p><strong>Flat, and deliberately.</strong> {@code quotaRemaining} and {@code resetAt} arrive together on a
 * {@code RemainingQuota} — the same one {@code /complete} answers with whole — and are spelled out here as
 * two fields rather than nested under a key, because this body's shape is the contract's and a client should
 * read {@code quotaRemaining} in one place whichever call it came from.
 *
 * <p><strong>What is not here is as decided as what is.</strong> No {@code jti}, no token and no expiry:
 * this call grants nothing (ADR-0007), so there is nothing here a modified extension could present as an
 * authorization. No {@code maxMarktplaatsAccounts} either, though the tier grants one — nothing renders it
 * until #47 finds an identifier that can tell two Marktplaats accounts apart, and a field nobody reads is a
 * field somebody eventually reads wrongly. And no cooldown: the pacing rails (#25) answer at the moment of
 * refusal with a {@code retryAfter}, and a rail has nothing to say ahead of one.
 *
 * @param subscriptionStatus the mirror of Stripe's status, normalized to the seven the contract names and
 * spelled as this enum spells them — the same screaming-case vocabulary as the reason codes and the outcomes,
 * so a client reads one convention across the API. It is display state and not permission: whether it
 * <em>allows</em> a relist is asked of the gate, on the call that grants one
 * @param tier what the caller's plan is called, both halves, so that a client can brand a plan without
 * branching on text an operator may rewrite ({@link TierName})
 * @param quotaRemaining relists left in the current period, never below zero — the same subtraction the gate
 * refuses on and {@code /complete} answers with. {@code null} on an unlimited tier (ADR-0029), where there is
 * nothing left of a grant with no ceiling: the popup then draws the tier's name and "Unlimited reposts", and
 * neither a bar nor a date
 * @param relistQuotaPerPeriod what the tier grants for a whole period, which is the other half of the sentence
 * a popup draws: "2 <em>of 3</em> relists left". Added by #41, whose design draws the pair and whose first
 * implementation could only render the numerator — a client that had one number and not the other would be
 * left keeping a catalog of quotas ours never reaches, which is the same mistake {@link TierName} exists to
 * prevent for a tier's name. It is the tier's grant and not the subscriber's history, so it does not move when
 * a unit is spent; lowering it under a subscriber is an operator's to do (ADR-0014), and
 * {@code quotaRemaining} clamping at zero is what keeps the pair readable when they do. {@code null} on an
 * unlimited tier, and always {@code null} together with the field above it — one is the ceiling and the other
 * is what is left under it, so a tier with no ceiling has neither
 * @param resetAt the end of that period, which is when the number above comes back
 * @param features the flags the tier carries, as the {@code tier.features} object holds them. Empty on every
 * tier in the catalog today, and rendered as an empty object rather than omitted: "this plan grants no flags"
 * is an answer, where a missing field is a client's guess
 * @param paying whether Stripe is billing this account right now (T85, ADR-0036) — true through dunning,
 * false after a terminal end, exactly as {@code POST /api/checkout} reads it for T83's {@code 409}. What tells
 * the site's cards apart: somebody not paying is offered Checkout, somebody paying a <strong>Plan
 * switch</strong>. Not the same question as the tier, since the default tier may be given a price
 * @param rhythm the <strong>Rhythm</strong> they are billed at — {@code month}, {@code year} — so that their
 * own card can offer the other one. {@code null} when they are not paying, and also for a subscriber from
 * before T85 whose Price has not been mirrored since, which a client reads as "rhythm unknown"
 */
record DisplayState(SubscriptionStatus subscriptionStatus, TierName tier, Integer quotaRemaining,
		Integer relistQuotaPerPeriod, OffsetDateTime resetAt, Map<String, Object> features, boolean paying,
		String rhythm) {
}
