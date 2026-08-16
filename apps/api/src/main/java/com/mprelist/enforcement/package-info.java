/**
 * The gate: {@code POST /api/relist/authorize} and {@code POST /api/relist/complete}, per
 * {@code docs/enforcement-contract.md}.
 *
 * <p>Its public API is the two routes and, since #26, one question: {@link com.mprelist.enforcement.Quotas}
 * answers what a subscriber has left of the period they are in, and
 * {@link com.mprelist.enforcement.RemainingQuota} is what it answers with. That is the whole of what leaves —
 * {@code display}'s {@code /api/me} renders a {@code quotaRemaining} counted from {@code usage_reservation}
 * and nowhere else, so it either asks here or writes a second count that can disagree with the gate's in
 * front of a user. Everything else is still {@code internal}: the checks in the order the contract fixes, the
 * {@code usage_reservation} and {@code relist_event} tables, and the signing of the short-lived authorization
 * a verdict of {@code 200} comes with. {@code authorize} takes a unit before anything is deleted (#22) and
 * {@code complete} settles or refunds it against what the extension says happened (#23); a reservation
 * nothing ever reports on is handed back by the scheduled reconciliation this module also owns (#24), which
 * is the one thing in here that runs without a caller and the one answer in here that is a guess. The pacing
 * rail (#25) is the last check of the gate and the only one that is not about entitlement: it reads the same
 * table, asking when this account last relisted rather than what it is still holding.
 *
 * <p><strong>The port takes a {@code Subscription} rather than reading one</strong>, which is what keeps a
 * second reader from being a second lock: all three callers hold the caller's plan before they ask, and a
 * read of its own here would take the row again and could roll a window a second time. That the answer is
 * about a window somebody else read is the point of it — the number and the {@code resetAt} beside it then
 * provably describe one period.
 *
 * <p>ADR-0012 also sketches a {@code domain} package — the decision logic, pure, no Spring. There is still
 * none, and #25 is where that stopped being an oversight nobody had got to. That ticket was named as the
 * likeliest to create it and did produce the thing it was named for: {@code RelistPace} is rules with no
 * reading in them, and a suite that runs without a Spring context or a database. It stays {@code internal}
 * because the bar ADR-0012 sets is a <em>second reader</em> and it has one, {@code SafetyPolicy} — moving it
 * would widen a type's visibility to make room for a test, which is the trade the module boundary exists to
 * refuse. The ticket that creates {@code domain} is the one with a second caller, not the next one with an
 * arithmetic worth testing.
 */
@ApplicationModule
package com.mprelist.enforcement;

import org.springframework.modulith.ApplicationModule;
