package com.mprelist;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

/**
 * The client this suite calls out with, and the one place the checked exceptions of {@code HttpClient.send}
 * become unchecked ones.
 *
 * <p>Two fixtures drive HTTP directly — {@link KeycloakFromCompose} against a container it started,
 * {@link ResourceServerTest} against the application on a real port — and the arm worth having once is the
 * {@link InterruptedException} one, which has to put the flag back rather than swallow it.
 *
 * <p>Redirects are never followed. A redirect is an answer these tests read rather than a step on the way to
 * one: Keycloak states half of its refusals through the redirect URI, and which of the two ways it refuses is
 * itself the subject of some of them.
 */
final class Http {

	static HttpResponse<String> send(HttpRequest request) {
		try {
			return CLIENT.send(request, HttpResponse.BodyHandlers.ofString());
		}
		catch (IOException unreachable) {
			throw new UncheckedIOException("Cannot reach " + request.uri(), unreachable);
		}
		catch (InterruptedException interrupted) {
			Thread.currentThread().interrupt();
			throw new IllegalStateException("Interrupted waiting for " + request.uri(), interrupted);
		}
	}

	private Http() {
	}

	private static final HttpClient CLIENT = HttpClient.newBuilder()
			.followRedirects(HttpClient.Redirect.NEVER).build();

}
