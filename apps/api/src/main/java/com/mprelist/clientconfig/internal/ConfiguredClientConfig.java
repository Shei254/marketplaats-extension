package com.mprelist.clientconfig.internal;

import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * The document an operator has deployed, read once at startup ({@code mprelist.client-config.document}).
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

	ConfiguredClientConfig(@Value("${mprelist.client-config.document}") String document) {
		this.document = parse(document);
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
	 * What an operator may write, which is {@link ClientConfig} without the version — the one field of it
	 * that is this code's rather than theirs.
	 */
	private record Overrides(Map<String, String> endpoints, ClientConfig.Csrf csrf, ClientConfig.Pacing pacing) {
	}

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
