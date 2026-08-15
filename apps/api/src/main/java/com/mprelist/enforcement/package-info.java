/**
 * The gate: {@code POST /api/relist/authorize} and {@code POST /api/relist/complete}, per
 * {@code docs/enforcement-contract.md}.
 *
 * <p>Its public API is the routes and nothing else — no other module asks this one anything, and every type it
 * holds is therefore in {@code internal}: the two routes, the checks in the order the contract fixes, the
 * {@code usage_reservation} and {@code relist_event} tables, and the signing of the short-lived authorization
 * a verdict of {@code 200} comes with. {@code authorize} takes a unit before anything is deleted (#22) and
 * {@code complete} settles or refunds it against what the extension says happened (#23); a reservation
 * nothing ever reports on is #24's to reconcile.
 *
 * <p>#26's {@code /api/me} is what will first ask this module something from outside it — {@code
 * quotaRemaining} is counted from the {@code usage_reservation} table and nowhere else — so {@code
 * RemainingQuota} is the type that leaves {@code internal} on that ticket, and the amendment to ADR-0012's
 * list is that ticket's to make.
 *
 * <p>ADR-0012 also sketches a {@code domain} package — the decision logic, pure, no Spring. There is none yet:
 * the decision is a status and two numbers the same method has just read, and a package holding one function
 * with one caller would be structure ahead of a reason for it. The ticket that gives that decision a second
 * reader is the one that creates it — #25's SafetyPolicy is the likeliest, since it adds the first check whose
 * own rules are worth exercising without a database.
 */
@ApplicationModule
package com.mprelist.enforcement;

import org.springframework.modulith.ApplicationModule;
