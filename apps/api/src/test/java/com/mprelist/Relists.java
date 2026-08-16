package com.mprelist;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;

import com.mprelist.Subscribers.Subscriber;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The two calls of the gate, made over a real port the way the extension makes them: {@code authorize} before
 * anything is deleted, {@code complete} to say what happened.
 *
 * <p>One home for it, because three suites now make the same two calls — {@link RelistAuthorizationTest},
 * {@link RelistCompletionTest} and {@link ReservationReconciliationTest} — and what was copied between them
 * was not a line but a request: the URI, the timeout, the two headers, the arm that omits the {@code
 * Authorization} one, and the JSON each body is spelled in. A suite holding its own copy of that is one that
 * can come to send a subtly different request than the suite beside it and still pass, which is the failure a
 * shared fixture is worth having for. It is {@link Subscribers}' argument about rows, applied to the calls.
 *
 * <p>Over a real port rather than through MockMvc, for T10's reason and T13's: the first check in the order is
 * the token, and MockMvc installs the filter chain that enforces it only when {@code spring-security-test}
 * happens to be on the classpath.
 *
 * <p>Each suite keeps its own names for these — {@code authorize}, {@code fire}, {@code abandoned} — because
 * what reads well in a test is not what reads well on a fixture. A forwarder under a <em>different</em> name
 * is the suite's vocabulary; one under the same name would be a second name for one thing.
 */
final class Relists {

	Relists(int port) {
		this.port = port;
	}

	// --- authorize --------------------------------------------------------------------------------------

	/**
	 * The authorization a report is then made against, taken the way the extension takes one, and answering
	 * with the {@code jti} it granted.
	 *
	 * <p>Asserted at 200 here rather than left to the caller: every suite that wants a {@code jti} wants a real
	 * one, and a grant that was refused would otherwise fail later as an unreadable JSON error rather than
	 * here as the refusal it is. Arranging the reservation row directly instead would be arranging a {@code
	 * jti} this API never issued — which is the subject of its own test in {@link RelistCompletionTest} and of
	 * none of the rest.
	 */
	UUID authorized(Subscriber user, String adId) {
		HttpResponse<String> granted = authorizing(user, adId);
		assertThat(granted.statusCode()).isEqualTo(200);
		return UUID.fromString(Json.of(granted).get("jti").asString());
	}

	/** The same call, unasserted, for the suites whose subject is how it refuses. */
	HttpResponse<String> authorizing(Subscriber user, String adId) {
		return authorizing(user.token(), "{\"adId\": \"" + adId + "\"}");
	}

	/**
	 * Token and body as given, for the tests whose subject is a request that is wrong — no token, a body that
	 * is not JSON, a field that is missing. A null token omits the header entirely rather than sending an empty
	 * one, since those are different things for the resource server to refuse.
	 */
	HttpResponse<String> authorizing(String token, String body) {
		return post("/api/relist/authorize", token, body);
	}

	// --- complete ---------------------------------------------------------------------------------------

	HttpResponse<String> completing(Subscriber user, UUID jti, String outcome) {
		return completing(user.token(), "{\"jti\": \"" + jti + "\", \"outcome\": \"" + outcome + "\"}");
	}

	/** Token and body as given, for {@link #authorizing(String, String)}'s reason. */
	HttpResponse<String> completing(String token, String body) {
		return post("/api/relist/complete", token, body);
	}

	// --- reading a refusal ------------------------------------------------------------------------------

	/**
	 * A {@code 4xx} that is not a denial: the status, and nothing whatever to read beside it.
	 *
	 * <p>Stronger than "carries no {@code reason}", and deliberately. That assertion passed against Spring
	 * Boot's default error body — {@code {timestamp, status, error, path}} — which names no reason code and so
	 * satisfied the letter of {@code docs/enforcement-contract.md} while being a second body shape on the same
	 * endpoints, echoing the caller's own request path back at them. What the contract means by carrying no
	 * reason is that there is nothing here to act on, and an empty body is the only version of that a test
	 * cannot pass by accident.
	 *
	 * <p>The challenge header is asserted absent for the same reason it is asserted present on a {@code 401}
	 * elsewhere: it belongs to authentication (RFC 6750), and these callers were authenticated.
	 */
	static void carriesNothingButItsStatus(HttpResponse<String> answered) {
		assertThat(answered.body()).isEmpty();
		assertThat(answered.headers().firstValue("WWW-Authenticate")).isEmpty();
	}

	// --- the request itself -----------------------------------------------------------------------------

	private HttpResponse<String> post(String path, String token, String body) {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + this.port + path))
				.timeout(Duration.ofSeconds(20))
				.header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
		return Http.send((token == null ? request : request.header("Authorization", "Bearer " + token)).build());
	}

	private final int port;

}
