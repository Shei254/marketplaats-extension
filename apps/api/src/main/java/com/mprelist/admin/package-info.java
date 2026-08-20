/**
 * Operator-facing endpoints, guarded by the {@code ADMIN} realm role. No CRUD screens — deferred by
 * ADR-0014.
 *
 * <p>#27 (T18) shipped the guard and no endpoint: {@code /api/admin/**} needs the role, said once as a
 * {@link com.mprelist.identity.RoutesNeedingARole} the filter chain applies, so that the routes T53 (#84)
 * adds are closed by being here rather than by each of them remembering to ask.
 */
@ApplicationModule
package com.mprelist.admin;

import org.springframework.modulith.ApplicationModule;
