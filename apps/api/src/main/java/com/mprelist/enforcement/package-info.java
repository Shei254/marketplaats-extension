/**
 * The gate: {@code POST /api/relist/authorize} and {@code POST /api/relist/complete}, per
 * {@code docs/enforcement-contract.md}.
 *
 * <p>Its public API is the routes and nothing else — no other module asks this one anything, and every type it
 * holds is therefore in {@code internal}: the route, the checks in the order the contract fixes, the
 * {@code usage_reservation} table, and the signing of the short-lived authorization a verdict of {@code 200}
 * comes with. {@code authorize} is here since #22 (T13); {@code complete} arrives with #23 (T14) and is what
 * settles or refunds a reservation this one took.
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
