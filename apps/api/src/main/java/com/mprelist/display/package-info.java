/**
 * Display state: {@code GET /api/me}, the unsigned snapshot the popup and the dashboard render from
 * ({@code docs/enforcement-contract.md}, ADR-0007).
 *
 * <p><strong>It is never a grant, and the module exists to keep that true structurally.</strong> ADR-0007's
 * whole point is that the relist path ignores this answer completely — a stale {@code active} in a client's
 * cache cannot cause a relist, because only a fresh {@code 200} from {@code /api/relist/authorize} can. A
 * module named for the display therefore has nothing in it that could ever hand one out: it takes no
 * reservation, signs nothing and writes nothing of its own. What it does is read four modules' answers and
 * put them in one body.
 *
 * <p><strong>Sixth module, and it is here rather than in one of the five because of a cycle.</strong> The
 * status, the tier and the window are {@code subscription}'s, what the tier is called is {@code catalog}'s,
 * and {@code quotaRemaining} is counted from {@code enforcement}'s {@code usage_reservation} and nowhere else.
 * {@code enforcement} already reads the other two, so putting this route in {@code subscription} — the module
 * whose concept dominates the body — would point a dependency straight back at a module that depends on it,
 * and the boundary check refuses a cycle as readily as it refuses a reach into {@code internal}. The composer
 * of a view over four modules is its own module or it is a cycle; ADR-0012 records the choice.
 *
 * <p>Its public API is the route and nothing else. Nobody asks this module anything: it is the leaf that asks
 * everybody. What it asks {@code enforcement} for is {@code Quotas.leftFor}, which is the one thing that
 * module publishes and the reason {@code RemainingQuota} left its {@code internal} package on this ticket —
 * the number a popup renders as "1 relist left" and the number the gate refuses on are one subtraction, or
 * they are two that can disagree in front of a user.
 */
@ApplicationModule
package com.mprelist.display;

import org.springframework.modulith.ApplicationModule;
