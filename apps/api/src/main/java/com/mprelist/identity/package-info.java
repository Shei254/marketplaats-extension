/**
 * Who the caller is. The API is an OAuth2 resource server here (ADR-0005): Keycloak's access token is
 * validated, and {@link com.mprelist.identity.CurrentUser} is what any other module's controller declares to
 * be told whose token it was.
 *
 * <p>{@code UserRef} — the other half of the public API ADR-0012 gives this module — waits for #20, which is
 * what first provisions the {@code app_user} row such a reference would name. Everything that reads a claim
 * or knows how Keycloak spells one is in {@code internal}, which is the whole of the swap ADR-0009 wants to
 * keep possible.
 */
@ApplicationModule
package com.mprelist.identity;

import org.springframework.modulith.ApplicationModule;
