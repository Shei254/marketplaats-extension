package com.mprelist.enforcement.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.json.JsonMapper;

/**
 * The body of {@code POST /api/relist/authorize}, read as bytes rather than as a value the suite built (#147).
 *
 * <p>A unit test beside {@link RelistPaceTest} rather than another arm of {@code RelistAuthorizationTest},
 * because what is asserted here is the <em>reading</em> and not the gate: whether an older build's body still
 * means what it meant, and whether a flag it never sends comes out as the {@code false} everything downstream
 * assumes. Those are questions about one class, and asking them through a real port would cost a Postgres and
 * a Keycloak to compare two booleans.
 */
class AuthorizeRequestTest {

	/**
	 * A body from a build that predates the flag reads as a request that did not ask for a batch — which is
	 * the whole of what "an older build is unaffected" means (ADR-0025). An extension release takes days and
	 * an API deploy takes minutes, so this body is what the API will mostly be answering for a while after
	 * this ships.
	 */
	@Test
	void aBodyThatNamesNoBatchIsARequestThatDidNotAskForOne() {
		AuthorizeRequest request = read("""
				{"adId": "ad-1"}""");

		assertThat(request.adId().value()).isEqualTo("ad-1");
		assertThat(request.batch()).isFalse();
	}

	/** And one that asks for a batch says so, which is the only way this API can ever know. */
	@Test
	void andOneThatAsksForOneSaysSo() {
		assertThat(read("""
				{"adId": "ad-1", "batch": true}""").batch()).isTrue();
	}

	/**
	 * Declining it is the same request as never naming it. The component is a {@code boolean} rather than a
	 * {@code Boolean} exactly so that the two cannot become different states — a third one would be a
	 * distinction neither end of this contract has a word for.
	 */
	@Test
	void andDecliningItIsTheSameRequestAsNeverNamingIt() {
		assertThat(read("""
				{"adId": "ad-1", "batch": false}""")).isEqualTo(read("""
				{"adId": "ad-1"}"""));
	}

	/**
	 * A field this contract does not name is ignored rather than refused — an older build still sending
	 * {@code marktplaatsAccountId} has to go on working, since ADR-0007's 2026-08-13 refinement removed it
	 * from the request and not from every installed release.
	 */
	@Test
	void andAFieldTheContractRemovedIsIgnoredRatherThanRefused() {
		assertThat(read("""
				{"adId": "ad-1", "marktplaatsAccountId": "whatever-it-used-to-send"}""").batch()).isFalse();
	}

	/** And a body naming no ad is a request that could not be read, which the route answers as a bare 400. */
	@Test
	void butABodyNamingNoAdIsNotARequestAtAll() {
		assertThatThrownBy(() -> read("{}")).hasMessageContaining("has to name it");
	}

	private static AuthorizeRequest read(String body) {
		return JsonMapper.builder().build().readValue(body, AuthorizeRequest.class);
	}

}
