package com.mprelist.catalog;

import java.util.UUID;

/**
 * A row of our own {@code tier} table, named the one way that survives an admin's edit. {@code name} is
 * display text an operator may rewrite at any time and {@code code} is the handle the seed upserts on, so the
 * primary key is the only thing another module can hold onto without depending on what the catalog is
 * currently called.
 *
 * <p>A type rather than a bare {@link UUID} because the two ids that meet in a {@code subscription} row —
 * this one and {@code identity}'s {@code UserRef} — are both UUIDs and are both written by the same insert.
 * The compiler is the cheapest thing that will ever notice them swapped.
 *
 * @param id the {@code tier.id} this refers to
 */
public record TierId(UUID id) {

	public TierId {
		if (id == null) {
			throw new IllegalArgumentException("A tier reference naming no row is not one anything can resolve");
		}
	}

}
