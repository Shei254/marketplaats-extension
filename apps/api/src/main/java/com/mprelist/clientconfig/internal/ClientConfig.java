package com.mprelist.clientconfig.internal;

import java.util.Map;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * The document {@code GET /api/client-config} answers with (ADR-0013).
 *
 * <p><strong>A patch, not a configuration.</strong> Every field but the version is optional and
 * {@code {"schemaVersion":1}} is what a healthy deployment serves: the extension's built-in defaults are the
 * configuration, and this says only where an operator has had to depart from them. That is what keeps this
 * API from holding a second copy of nine Marktplaats paths it would then be able to serve out of date.
 *
 * <p><strong>Strictly data.</strong> Paths, header names, selectors and numbers — nothing the client
 * evaluates, compiles or executes, which is the ADR's hard constraint and MV3's rule about remotely hosted
 * code. The one shape that could have bent it, a regular expression for pulling the CSRF token out of a page,
 * is deliberately absent: {@link Csrf.Extractor} is a selector and an attribute, so a served value is
 * compared against something and never compiled.
 *
 * <p><strong>{@code schemaVersion} is ours and not an operator's</strong> ({@link #CURRENT}). It names the
 * shape of this record, so it changes when this record does; an operator who could set it could tell every
 * client to read a shape nobody serves. A client that does not know the version ignores the document whole.
 *
 * <p>Absent fields are omitted from the JSON rather than sent as {@code null} — {@code {"schemaVersion":1}}
 * is a smaller thing to read, and to a client "there is no override" and "the override is null" have to mean
 * the same thing anyway.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
record ClientConfig(int schemaVersion, Map<String, String> endpoints, Csrf csrf, Pacing pacing) {

	/**
	 * The version this API serves. A constant rather than a setting: it describes this record, and the day
	 * the record changes shape is the day this number does.
	 *
	 * <p>It is {@code 1} and has never been anything else. Raising it strands every installed build on its
	 * built-in defaults until it is updated — the same blast radius as the header of T43 (#52) and for the
	 * same reason, so the policy here is the same one: additive by default, and a bump only for a shape that
	 * genuinely cannot be read the old way.
	 */
	static final int CURRENT = 1;

	/** The empty patch: nothing is overridden, which is what a healthy deployment serves. */
	static ClientConfig nothingOverridden() {
		return new ClientConfig(CURRENT, null, null, null);
	}

	/**
	 * How the extension finds Marktplaats's CSRF token. <strong>Replaced whole or not at all</strong> — the
	 * modes carry different fields, so a merge could produce a {@code none} still holding a {@code url},
	 * which is a config that says two things.
	 */
	@JsonInclude(JsonInclude.Include.NON_NULL)
	record Csrf(CsrfMode mode, String header, String name, String url, Extractor extractor) {

		/** Where in a fetched page the token is. A selector and an attribute, never a pattern. */
		record Extractor(String selector, String attribute) {
		}

	}

	/**
	 * The randomised gap between two relists, in milliseconds (ADR-0008; the seam T46, #54 left open).
	 *
	 * <p>Client-side because it has to be: this API can refuse a relist that came too soon, it cannot make
	 * one arrive at a moment a person plausibly clicked. What it can do is say how long the gap should be
	 * without waiting days for a store release, which is what this field is.
	 */
	record Pacing(long minMs, long maxMs) {
	}

}
