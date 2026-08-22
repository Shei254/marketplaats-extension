package com.mprelist.clientconfig.internal;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /api/client-config} — what the extension should do differently from what it was built to do
 * (T27, #36; ADR-0013, {@code docs/enforcement-contract.md}).
 *
 * <p><strong>It always answers, and usually with nothing.</strong> {@code {"schemaVersion":1}} is the healthy
 * deployment's answer and means "your defaults are correct". There is no {@code 404} for an absent document
 * and no {@code 503} for one that could not be built: the document is a setting this application has already
 * read, so the only way to fail here would be to have failed to start.
 *
 * <p><strong>Authenticated, like every other route, and this one was expected to want opening.</strong>
 * {@code ResourceServerSecurity} and {@code RoutesNeedingARole} both name this ticket as the first that might
 * ask for an anonymous route. It does not, and the reason is that nothing needs it to: everything this
 * document configures — driving Marktplaats's internal API on the user's behalf — is behind a sign-in, so a
 * caller who cannot hold a token has nothing to do with the answer. Opening a route in an API that is closed
 * by default would buy an unauthenticated copy of our own instructions for driving somebody else's site.
 *
 * <p><strong>Nothing is cached here.</strong> The caching ADR-0013 asks for is the service worker's, which is
 * where it has to be — the point is a client that already holds the document rather than a server that
 * answers quickly. This end is a field read.
 */
@RestController
class ServeClientConfig {

	ServeClientConfig(ConfiguredClientConfig configured) {
		this.configured = configured;
	}

	@GetMapping(PATH)
	ClientConfig clientConfig() {
		return this.configured.document();
	}

	/** Named once, because the test and the contract both spell it and one of the three should be the code. */
	static final String PATH = "/api/client-config";

	private final ConfiguredClientConfig configured;

}
