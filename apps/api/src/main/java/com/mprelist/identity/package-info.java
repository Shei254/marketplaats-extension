/**
 * Who the caller is. Keycloak JWT validation and the {@code CurrentUser} resolved from the token; its
 * planned public API is {@code UserRef} and {@code CurrentUser} (ADR-0012).
 *
 * <p>Empty until #19 (T10). The annotation is what makes the module exist today: an empty package
 * compiles to nothing at all, and a module Modulith cannot see is a module it cannot check.
 */
@ApplicationModule
package com.mprelist.identity;

import org.springframework.modulith.ApplicationModule;
