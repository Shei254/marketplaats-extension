package com.mprelist;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The application with no Stripe webhook secret configured — which is every developer's, since the secret is
 * different for each {@code stripe listen} session and cannot be committed (#82, T51).
 *
 * <p>Two claims, and they pull in opposite directions, which is why both are asserted here rather than
 * assumed:
 *
 * <ul>
 * <li><strong>It starts.</strong> Unlike the pacing rails and the reconciliation window, this setting has an
 * empty default: an API that would not boot without a Stripe secret would make every unrelated change need
 * one, and the secret is per-session.
 * <li><strong>And it refuses everything.</strong> "We cannot tell whether this is Stripe" has exactly one
 * safe reading, and the alternative — an unconfigured deployment taking anything that posts JSON — would let
 * a stranger publish tiers into the catalog every subscriber is priced by.
 * </ul>
 *
 * <p>A class of its own because the setting is what the context is built from, in the shape
 * {@link KeycloakRealmWithoutAnExtensionIdTest} already uses for the same reason.
 *
 * <p><strong>Unconfigured is said here rather than assumed of the machine.</strong> A developer walking slice
 * C exports {@code MPRELIST_STRIPE_WEBHOOK_SECRET}, and {@code .env} now holds one for {@code bootRun} and
 * the test JVMs alike; inherited, it would leave this suite passing for the wrong reason — the event below is
 * unsigned, so it is refused either way, and both claims above would quietly be about a configured
 * application.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = "mprelist.stripe.webhook-secret=")
@Import(PostgresFromCompose.class)
class StripeWithoutAWebhookSecretTest {

	@LocalServerPort
	private int port;

	@Autowired
	private JdbcTemplate db;

	@Test
	void theApplicationStartsWithoutOne() {
		// Reached at all only because the context came up, which is the assertion. The read is what says the
		// rest of the application is working rather than merely present.
		assertThat(this.db.queryForList("select code from tier", String.class)).contains("pro");
	}

	/**
	 * And every event is refused — including one that is perfectly well-formed, which is the case that would
	 * otherwise slip through: with no secret there is nothing to check it against, and "nothing to check
	 * against" must not read as "nothing to object to".
	 */
	@Test
	void andRefusesAnEventItCannotCheck() {
		String payload = """
				{"id":"evt_1","type":"price.created","data":{"object":{"id":"price_x","object":"price",
				"metadata":{"tier_code":"pro"}}}}""";

		HttpResponse<String> refused = Http.send(HttpRequest
				.newBuilder(URI.create("http://localhost:" + this.port + "/api/stripe/webhook"))
				.header("Content-Type", "application/json")
				// Signed with *something*, so what is being asserted is the missing secret at this end rather
				// than a missing header at the other.
				.header("Stripe-Signature", "t=1,v1=00")
				.POST(HttpRequest.BodyPublishers.ofString(payload, UTF_8))
				.build());

		assertThat(refused.statusCode()).isEqualTo(400);
		assertThat(this.db.queryForList("select code from tier join tier_price on tier.id = tier_price.tier_id",
				String.class))
				.isEmpty();
	}

}
