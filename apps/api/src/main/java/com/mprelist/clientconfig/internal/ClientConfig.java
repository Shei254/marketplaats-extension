package com.mprelist.clientconfig.internal;

import java.util.Map;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * The document {@code GET /api/client-config} answers with (ADR-0013).
 *
 * <p><strong>A patch, not a configuration.</strong> Every overridable field is optional, and a healthy
 * deployment serves the version and the rails and nothing else: the extension's built-in defaults are the
 * configuration, and this says only where an operator has had to depart from them. That is what keeps this
 * API from holding a second copy of nine Marktplaats paths it would then be able to serve out of date.
 *
 * <p><strong>{@link Rails} is the exception and is admitted as one</strong> (ADR-0025). Every other field
 * replaces something the client shipped with; that one states a fact about <em>this</em> API — how many
 * relists it will authorize in an hour — which the extension quotes back to the user as "about two hours" when
 * they select twenty-five ads. It is therefore always present, and it is stamped rather than written, like
 * {@link #CURRENT} and for the same reason turned around: an operator who dropped the burst limit during an
 * incident and forgot to re-paste a JSON document would leave every popup quoting a duration that is no longer
 * true, which is the one thing serving it was supposed to prevent.
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
record ClientConfig(int schemaVersion, Map<String, String> endpoints, Csrf csrf, Pacing pacing,
		Pacing bulkPacing, Rails rails) {

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

	/**
	 * The empty patch: nothing is overridden, which is what a healthy deployment serves.
	 *
	 * <p>No rails here, and that is not the same thing as a deployment with none. This is what an
	 * <em>operator</em> wrote, and the rails are not theirs to write; {@code ConfiguredClientConfig} stamps
	 * them onto whatever this returns, so the document that leaves the route always carries them.
	 */
	static ClientConfig nothingOverridden() {
		return new ClientConfig(CURRENT, null, null, null, null, null);
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
	 * The randomised gap between two relists, in milliseconds (ADR-0008; the seam T46, #54 left open) — and,
	 * as {@code bulkPacing}, the wider gap <em>inside a batch</em> (#147, ADR-0025).
	 *
	 * <p>Client-side because it has to be: this API can refuse a relist that came too soon, it cannot make
	 * one arrive at a moment a person plausibly clicked. What it can do is say how long the gap should be
	 * without waiting days for a store release, which is what this field is.
	 *
	 * <p><strong>Two windows rather than one, because the two gaps are watched differently.</strong> Somebody
	 * sits through the gap between two reposts they pressed, and walks away from the gaps inside a run they
	 * started — so the first stays short enough to be tolerable and the second is drawn wide. The bulk window
	 * also has a floor this one does not: {@code chrome.alarms} advances a batch and MV3 clamps it at about 30
	 * seconds, so a window under that is not a jittered gap but a metronome, which is the one shape ADR-0008
	 * rules out. {@code ConfiguredClientConfig} is where that floor is refused.
	 */
	record Pacing(long minMs, long maxMs) {
	}

	/**
	 * The rails this API actually enforces (#25, ADR-0008), served so that the popup can say how long a
	 * selection will take before somebody commits to it (#147, ADR-0025).
	 *
	 * <p><strong>It gates nothing.</strong> The real refusal is {@code RATE_LIMITED} from the gate, in the
	 * ordinary way and on this API's own reading of its own settings; what a client does with these numbers is
	 * arithmetic on a screen. So a client that ignored them, or one running against an older API that sends
	 * none, is wrong about a sentence and right about everything else — which is the only reason it is safe to
	 * hand a rail to the side ADR-0007 treats as the adversary.
	 *
	 * <p><strong>The minimum interval is deliberately not here.</strong> It is the rail a paced client already
	 * clears by construction ({@code mprelist.client-config.pacing} floors above it), so it never appears in
	 * the estimate; what makes a batch of twenty-five take two hours is the burst cap and the window it counts
	 * in, and those are the two numbers this carries.
	 *
	 * @param burstLimit {@code mprelist.safety.burst-limit} — how many relists may be authorized inside the
	 * window below
	 * @param burstWindowMs {@code mprelist.safety.burst-window}, in milliseconds rather than as a duration
	 * string, because the client does arithmetic with it and {@code PT1H} is a thing to parse
	 */
	record Rails(int burstLimit, long burstWindowMs) {
	}

}
