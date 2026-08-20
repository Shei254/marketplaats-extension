package com.mprelist.admin.internal;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.mprelist.identity.RoutesNeedingARole;

/**
 * Everything this module will ever serve is for operators, and it says so once (#27, T18).
 *
 * <p><strong>The guard is by path, not by route.</strong> {@code /api/admin/**} is closed to anyone without
 * the realm's {@code ADMIN} role — including paths nothing has been written for yet, which is the point:
 * T53's tier CRUD is guarded by being where it is rather than by each handler remembering an annotation, and
 * the failure mode of the alternative is a new route that is open and looks exactly like the others.
 *
 * <p>It is a rule and not a filter chain of its own. A second chain would have to restate how a token is
 * read, how its realm roles become authorities and what a refusal looks like — three things
 * {@code identity} already owns — and the one that is easiest to leave out is the authorities converter,
 * whose absence closes these routes to operators too, silently and completely.
 */
@Configuration(proxyBeanMethods = false)
class OperatorsOnly {

	@Bean
	RoutesNeedingARole theAdminApiIsForOperators() {
		return new RoutesNeedingARole(PATH + "/**", ADMIN);
	}

	/**
	 * Not shared with anything, deliberately. A constant other modules could import would make this module's
	 * URL space theirs to depend on; the one place outside it that needs to know the path is the test that
	 * proves the guard, and a test asserting the literal is a test that would notice it changing.
	 */
	private static final String PATH = "/api/admin";

	/** The realm role, spelled as {@code infra/keycloak/mprelist-realm.json} spells it. */
	private static final String ADMIN = "ADMIN";

}
