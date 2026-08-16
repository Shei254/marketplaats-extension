/**
 * The gate: {@code POST /api/relist/authorize} and {@code POST /api/relist/complete}, per
 * {@code docs/enforcement-contract.md}.
 *
 * <p>Its public API is the routes and nothing else — no other module asks this one anything, and every type it
 * holds is therefore in {@code internal}: the two routes, the checks in the order the contract fixes, the
 * {@code usage_reservation} and {@code relist_event} tables, and the signing of the short-lived authorization
 * a verdict of {@code 200} comes with. {@code authorize} takes a unit before anything is deleted (#22) and
 * {@code complete} settles or refunds it against what the extension says happened (#23); a reservation
 * nothing ever reports on is handed back by the scheduled reconciliation this module also owns (#24), which
 * is the one thing in here that runs without a caller and the one answer in here that is a guess. The pacing
 * rail (#25) is the last check of the gate and the only one that is not about entitlement: it reads the same
 * table, asking when this account last relisted rather than what it is still holding.
 *
 * <p>#26's {@code /api/me} is what will first ask this module something from outside it — {@code
 * quotaRemaining} is counted from the {@code usage_reservation} table and nowhere else — so {@code
 * RemainingQuota} is the type that leaves {@code internal} on that ticket, and the amendment to ADR-0012's
 * list is that ticket's to make.
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
