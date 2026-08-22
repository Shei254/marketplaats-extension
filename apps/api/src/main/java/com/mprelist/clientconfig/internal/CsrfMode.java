package com.mprelist.clientconfig.internal;

import java.util.Locale;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * The ways the extension can find Marktplaats's CSRF token — <strong>names of branches that already exist in
 * the client</strong>, not behaviour this API delivers ({@code docs/internal-api-findings.md}).
 *
 * <p>This is where "strictly data" (ADR-0013) is enforced rather than asserted: an operator can say which of
 * four branches runs and what it looks for, and a mode this enum does not name is a document that fails to
 * parse and a deployment that does not start. There is no fifth thing a config could ask a client to do.
 *
 * <p>Spelled again in {@code packages/contracts} and in {@code docs/enforcement-contract.md}; the contract
 * package's own test holds all three to each other, the way it already does for the denial reasons and the
 * subscription statuses.
 */
enum CsrfMode {

	/** The token is in a {@code <meta>} tag on the page, by name. */
	META,

	/** It is in a cookie the page can read, by name. */
	COOKIE,

	/** A page is fetched and the token read out of it — what Marktplaats needs today. */
	FETCH,

	/** There is none, and nothing is sent. */
	NONE;

	/**
	 * Lower case on the wire and in the setting, because these are the client's own words for its own
	 * branches — {@code "fetch"} is what {@code docs/internal-api-findings.md} calls the mode that runs, and
	 * what the extension's {@code CsrfConfig} has always spelled. An operator writing this document is
	 * writing the extension's configuration; making them shout it in an API's house style would be this
	 * end's vocabulary leaking into the other's.
	 *
	 * <p>Not the same choice as the denial reasons, which are upper case in both places: those are this
	 * API's own vocabulary, invented here, and read only by code that learned them from this contract.
	 */
	@JsonValue
	String spelling() {
		return name().toLowerCase(Locale.ROOT);
	}

	/**
	 * A mode nobody serves is a document that does not parse, which is a deployment that does not start —
	 * see {@link ConfiguredClientConfig}.
	 *
	 * <p>It names the four that do rather than only the one that does not, because the operator reading this
	 * is looking at a startup failure in the middle of an outage: "no such mode: dom" leaves them guessing,
	 * and the guess they make is the second failed deploy. {@code valueOf} would have said less and shouted
	 * it in this end's case.
	 */
	@JsonCreator
	static CsrfMode of(String spelling) {
		for (CsrfMode mode : values()) {
			if (mode.spelling().equals(spelling)) {
				return mode;
			}
		}
		throw new IllegalArgumentException(
				"No client has a branch called '" + spelling + "'; the CSRF modes are " + spellings());
	}

	private static String spellings() {
		return java.util.Arrays.stream(values()).map(CsrfMode::spelling).collect(java.util.stream.Collectors.joining(", "));
	}

}
