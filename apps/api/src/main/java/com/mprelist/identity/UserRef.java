package com.mprelist.identity;

import java.util.UUID;

/**
 * The account behind the caller: our {@code app_user} row, which every other table in the schema points at.
 * A controller takes one as a parameter exactly as it takes a {@link CurrentUser}, and gets an account that
 * exists — the resolver behind it provisions on first sight of a subject, so there is no way to hold a
 * {@code UserRef} to a row that was never created.
 *
 * <p>The other half of the pair, and the reason both exist. {@link CurrentUser} carries the IdP's {@code sub}
 * and is what identity <em>is</em>; this carries our own key and is what the rest of the schema is written
 * against. Making the {@code sub} the foreign key everywhere would have been one type instead of two, and it
 * is the cheapest way to make Keycloak permanent — ADR-0009 wants it replaceable, and the swap then has to
 * rewrite every row rather than one column.
 *
 * <p>So a module that stores something about the caller takes this, and a module that only has to know who
 * signed in takes {@link CurrentUser}. Asking for this is also asking for the account to exist, which costs
 * the query that provisions it; #22's {@code authorize} needs the row and #36's client config does not.
 *
 * @param id the {@code app_user.id} this refers to, ours and stable across a change of identity provider
 */
public record UserRef(UUID id) {

	public UserRef {
		if (id == null) {
			throw new IllegalArgumentException("A user reference naming no row is not one anything can resolve");
		}
	}

}
