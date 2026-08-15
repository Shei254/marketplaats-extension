package com.mprelist;

import java.net.http.HttpResponse;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The reader the suites that drive HTTP parse answers with.
 *
 * <p>One mapper rather than one per suite. Three of them had built their own and read a response body through
 * it, which is a shape that stays identical right up until one of them needs the mapper configured — and then
 * the assertions that pass are the ones in whichever suite was remembered.
 *
 * <p>Deliberately not the application's own {@code ObjectMapper}: what these tests hold the API to is the
 * bytes on the wire, and a reader taken from the context under test is one that would forgive the API a
 * serialization setting it had got wrong on both sides.
 */
final class Json {

	/** The body of a response, parsed. */
	static JsonNode of(HttpResponse<String> response) {
		return MAPPER.readTree(response.body());
	}

	/** Decoded bytes, for the JWT halves the suites read out of a token by hand. */
	static JsonNode of(byte[] decoded) {
		return MAPPER.readTree(decoded);
	}

	/** Text, for the one subject that is a file in the working tree rather than an answer: the realm. */
	static JsonNode of(String text) {
		return MAPPER.readTree(text);
	}

	private Json() {
	}

	private static final JsonMapper MAPPER = JsonMapper.builder().build();

}
