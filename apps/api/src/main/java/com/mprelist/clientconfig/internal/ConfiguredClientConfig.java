package com.mprelist.clientconfig.internal;

import java.time.Duration;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * The document an operator has deployed, read once at startup ({@code mprelist.client-config.document}) —
 * plus the one field of it that has settings of its own.
 *
 * <p><strong>The pacing window is a pair of properties as well as a field.</strong> Everything else in the
 * document moves when Marktplaats moves it and not otherwise, so a line of JSON is the right shape for it;
 * how long the extension waits between two reposts is a judgement that gets revisited, and asking somebody
 * to re-paste a JSON document to change a number is how a setting ends up not being changed. Both routes
 * serve the same field, and setting it both ways is refused rather than resolved.
 *
 * <p><strong>Read once, on purpose.</strong> This is a setting, so it changes when the application restarts
 * and never between two requests — parsing it per call would be work done thousands of times for an answer
 * that cannot have moved, and would let two callers in one deployment get different documents if the parse
 * were ever made to depend on anything.
 *
 * <p><strong>A document that cannot be read stops the application from starting.</strong> That is the
 * opposite of how this API treats a Stripe key it has not been given — and the difference is who finds out.
 * An unset Stripe key is a developer running something else, told once at WARN; a <em>malformed</em>
 * client-config is an operator who has just deployed a fix for a Marktplaats change that has broken relisting
 * for everybody, and who is watching this start. Serving an empty document instead would let them believe
 * the fix had gone out, which is the worst thing this route could do at the worst moment for it. ADR-0013
 * says the same in its own words: config here is a production change.
 *
 * <p><strong>Unknown fields are refused too</strong>, which is the same argument one level down: an operator
 * who writes {@code endpoint} for {@code endpoints}, or {@code min_ms} for {@code minMs}, has deployed
 * nothing, and the only moment they can be told is this one. The alternative is a document that parses, an
 * application that starts, and a typo nobody sees until the next relist fails the same way it did before.
 *
 * <p><strong>What is not validated here is anything about the values themselves.</strong> Whether
 * {@code /seller/api/delete-ad-v2} is a path Marktplaats serves is not a question this API can answer, and
 * the client checks the shape of everything it reads anyway because storage is not ours to trust. What this
 * class guarantees is only that what it serves is the shape it says it is.
 */
@Component
class ConfiguredClientConfig {

	ConfiguredClientConfig(@Value("${mprelist.client-config.document}") String document,
			@Value("${mprelist.client-config.pacing.min-ms}") String minMs,
			@Value("${mprelist.client-config.pacing.max-ms}") String maxMs) {
		this.document = withPacing(parse(document), pacing(minMs, maxMs));
	}

	ClientConfig document() {
		return this.document;
	}

	/**
	 * An empty setting is the ordinary case and means nothing is overridden — not an error, and not something
	 * to say at WARN every time an application starts normally.
	 *
	 * <p>The version is stamped here rather than read: {@link ClientConfig#CURRENT} describes the shape this
	 * code serves, so an operator who could set it could tell every installed client to read a shape nobody
	 * is serving. Jackson would happily bind a {@code schemaVersion} out of the document, which is why the
	 * unknown-property refusal above is what stops one being written: naming it is an error rather than a
	 * value quietly ignored.
	 */
	private static ClientConfig parse(String document) {
		if (document == null || document.isBlank()) {
			return ClientConfig.nothingOverridden();
		}
		try {
			Overrides overrides = MAPPER.readValue(document, Overrides.class);
			return new ClientConfig(ClientConfig.CURRENT, overrides.endpoints(), overrides.csrf(),
					overrides.pacing());
		}
		catch (JacksonException unreadable) {
			throw new IllegalStateException(
					"mprelist.client-config.document is not a client-config document: " + unreadable.getOriginalMessage(),
					unreadable);
		}
	}

	/**
	 * The pacing window as its own pair of settings, which is the shape the one field anybody tunes deserves
	 * ({@code mprelist.client-config.pacing}).
	 *
	 * <p><strong>Both or neither.</strong> A floor with no ceiling is not a window, and there is no sensible
	 * half of one to invent: a missing ceiling could only be the built-in one, which lives in the extension
	 * and is not a number this API knows. So half a pair is refused rather than completed.
	 *
	 * <p><strong>Read as text and parsed here</strong>, because an unset setting has to be distinguishable
	 * from a zero one — {@code minMs=0} is a legitimate window with no floor, and a {@code long} property
	 * with an empty default cannot be bound at all.
	 *
	 * @return the window, or {@code null} where neither was set — which is every deployment nobody has tuned
	 */
	private static ClientConfig.Pacing pacing(String minMs, String maxMs) {
		boolean hasMin = minMs != null && !minMs.isBlank();
		boolean hasMax = maxMs != null && !maxMs.isBlank();
		if (!hasMin && !hasMax) {
			return null;
		}
		if (hasMin != hasMax) {
			throw new IllegalStateException("A pacing window needs both ends: mprelist.client-config.pacing"
					+ ".min-ms was " + describe(minMs) + " and .max-ms was " + describe(maxMs));
		}
		long min = milliseconds("min-ms", minMs);
		long max = milliseconds("max-ms", maxMs);
		if (max < min) {
			throw new IllegalStateException("A pacing window has to run forwards: mprelist.client-config"
					+ ".pacing.min-ms was " + min + " and .max-ms was " + max);
		}
		if (max > LONGEST_SENSIBLE_GAP.toMillis()) {
			// Not taste, and not a rail: the extension waits this out *inside* its service worker, which
			// Chrome kills a few minutes after it goes idle. A window past that is a relist that never
			// starts, and the client drops the whole document rather than half-applying it — so an operator
			// who sets one has deployed nothing at all, and this is the only moment they can be told.
			throw new IllegalStateException("A pacing window has to finish inside the life of the extension's "
					+ "service worker, which is " + LONGEST_SENSIBLE_GAP + ": mprelist.client-config.pacing"
					+ ".max-ms was " + max);
		}
		return new ClientConfig.Pacing(min, max);
	}

	/**
	 * The settings laid over the document, where an operator has used them.
	 *
	 * <p><strong>A document that also carries {@code pacing} is refused rather than overridden.</strong>
	 * Silently preferring one would leave a deployment where the JSON says one window, the environment says
	 * another, and the answer depends on which this method happened to be written to favour. Two settings for
	 * one value is a mistake to report, and startup is where this file reports mistakes.
	 */
	private static ClientConfig withPacing(ClientConfig document, ClientConfig.Pacing pacing) {
		if (pacing == null) {
			return document;
		}
		if (document.pacing() != null) {
			throw new IllegalStateException("The pacing window is set twice: mprelist.client-config.document "
					+ "carries a `pacing` block and mprelist.client-config.pacing.min-ms/.max-ms are set too. "
					+ "Keep one of them.");
		}
		return new ClientConfig(document.schemaVersion(), document.endpoints(), document.csrf(), pacing);
	}

	private static long milliseconds(String setting, String value) {
		try {
			long milliseconds = Long.parseLong(value.strip());
			if (milliseconds < 0) {
				throw new NumberFormatException("negative");
			}
			return milliseconds;
		}
		catch (NumberFormatException notANumber) {
			throw new IllegalStateException("mprelist.client-config.pacing." + setting
					+ " is a whole number of milliseconds, not " + describe(value), notANumber);
		}
	}

	private static String describe(String value) {
		return value == null || value.isBlank() ? "unset" : "`" + value.strip() + "`";
	}

	/**
	 * What an operator may write, which is {@link ClientConfig} without the version — the one field of it
	 * that is this code's rather than theirs.
	 */
	private record Overrides(Map<String, String> endpoints, ClientConfig.Csrf csrf, ClientConfig.Pacing pacing) {
	}

	/** Chrome's ceiling on a service worker, which is what the extension has to do the waiting inside. */
	private static final Duration LONGEST_SENSIBLE_GAP = Duration.ofMinutes(5);

	/**
	 * Its own mapper, configured to refuse what it does not recognise. The application's own is not asked,
	 * both because it is configured for the opposite habit — a response reader forgiving of fields it has not
	 * heard of is what keeps clients working across a deploy — and because {@code billing} and {@code catalog}
	 * already build their own for reading Stripe payloads and JSONB columns.
	 */
	private static final JsonMapper MAPPER = JsonMapper.builder()
			.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
			.build();

	private final ClientConfig document;

}
