/**
 * Who the caller is. The API is an OAuth2 resource server here (ADR-0005): Keycloak's access token is
 * validated, and {@link com.mprelist.identity.CurrentUser} is what any other module's controller declares to
 * be told whose token it was.
 *
 * <p>{@link com.mprelist.identity.UserRef} is the other half of the public API ADR-0012 gives this module,
 * and asking for one is what provisions the {@code app_user} row it names — this application has no login of
 * its own, so the first request carrying an unknown subject is first login (#20).
 * {@link com.mprelist.identity.UserProvisioned} is how the rest of the application hears about it without
 * this module having to know who is listening.
 *
 * <p>Everything that reads a claim or knows how Keycloak spells one is in {@code internal}, which is the
 * whole of the swap ADR-0009 wants to keep possible.
 */
@ApplicationModule
package com.mprelist.identity;

import org.springframework.modulith.ApplicationModule;
