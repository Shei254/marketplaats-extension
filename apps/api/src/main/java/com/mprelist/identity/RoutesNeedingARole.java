package com.mprelist.identity;

/**
 * A module's statement that some of its routes are for holders of one realm role, published as a bean and
 * applied by the filter chain — which is the only thing in this application that decides what a request is
 * allowed to reach.
 *
 * <p><strong>Why a seam rather than a line in the chain.</strong> The alternative was
 * {@code requestMatchers("/api/admin/**")} spelled inside {@code identity}, which would put another module's
 * URL space in the one file that knows nothing else about it — and importing the pattern from {@code admin}
 * instead would point {@code identity} at a module that already points back at it, which is a cycle the
 * boundary check would reject. So the rule travels the way every other cross-module fact here does: as a
 * value, in the direction modules already depend (ADR-0012).
 *
 * <p><strong>It says what, not how.</strong> No Spring Security type appears in it, so a module declaring one
 * needs to know nothing about filter chains, and how a rule is turned into a guard stays in the single place
 * that also decides how a caller is authenticated and how a refusal is shaped.
 *
 * <p>Restricting only, and deliberately: there is no way to say "open this route to anyone" here. Every route
 * is closed until its own ticket opens it, and opening one is a decision that should be visible in the chain
 * rather than contributed from a module — the day #36's client config wants an anonymous route, that is a
 * change to this file's vocabulary and a reviewer will see it.
 *
 * @param pattern the paths it covers, as an ant-style pattern — a prefix rather than a route list, so a
 * route a later ticket adds under it is closed by being there rather than by remembering to say so
 * @param realmRole the role a caller must hold, spelled as the realm spells it and without the
 * {@code ROLE_} prefix Spring Security adds
 */
public record RoutesNeedingARole(String pattern, String realmRole) {

	public RoutesNeedingARole {
		if (pattern == null || pattern.isBlank()) {
			throw new IllegalArgumentException("A rule covering no path guards nothing");
		}
		if (realmRole == null || realmRole.isBlank()) {
			throw new IllegalArgumentException("A rule naming no role would close its routes to everybody");
		}
	}

}
