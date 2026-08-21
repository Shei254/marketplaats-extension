package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.mprelist.Subscribers.Subscriber;

/**
 * {@code POST /api/portal} as a route (T21, #31): who gets a Portal, who has nothing to manage, and who may
 * ask at all.
 *
 * <p><strong>No Stripe key is configured here, and that is what makes the suite possible</strong> —
 * {@link CheckoutTest}'s arrangement and its reason. Everything below is decided before Stripe would be asked:
 * whether the caller's row names a customer at all. The one answer that needs Stripe is the URL itself, which
 * over a real port would need a live account with its Portal configured, and that is the click-through's
 * (slice C, step 7). What we send Stripe is {@code PortalSessionTest}, against a stub on a loopback port.
 *
 * <p><strong>The interesting half is which refusal.</strong> "You have never bought anything" and "Stripe is
 * down" are one call apart and mean opposite things to somebody holding an invoice, so both are pinned here
 * against rows arranged to differ in exactly one column.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = "mprelist.stripe.secret-key=")
@Import(PostgresFromCompose.class)
class PortalTest {

	private static final MintedTokens IDP = MintedTokens.servingItsKeys();

	@DynamicPropertySource
	static void trustTheTokensThisSuiteMints(DynamicPropertyRegistry properties) {
		IDP.trustedAsTheIssuer(properties);
	}

	@AfterAll
	static void stopServingKeys() {
		IDP.close();
	}

	@BeforeEach
	void nobodyHasSignedInYet() {
		this.rows = new Subscribers(this.db, IDP, "portal-suite-");
		this.rows.nobodyHasRelistedYet();
	}

	/**
	 * The ordinary free account: a subscription row exists, and the Stripe customer column on it is null. There
	 * is genuinely nothing to manage, and saying so is a {@code 404} rather than an error — most accounts are
	 * this one.
	 */
	@Test
	void anAccountThatHasNeverPaidHasNothingToManage() {
		Subscriber user = this.rows.entitledTo(3);

		HttpResponse<String> refused = manageBilling(user.token());

		assertThat(refused.statusCode()).isEqualTo(404);
		assertThat(refused.body()).isEmpty();
	}

	/** Including somebody this API has only just met, whose row was written by the call itself (#20). */
	@Test
	void andSoDoesSomebodyWhoHasOnlyJustSignedIn() {
		assertThat(manageBilling(IDP.token()).statusCode()).isEqualTo(404);
	}

	/**
	 * A subscriber Stripe holds a customer for gets as far as Stripe — which is not configured here, so the
	 * answer is the unavailable one. The two refusals are different statuses on purpose: this row has billing
	 * to manage and a {@code 404} would tell a paying customer it does not exist.
	 */
	@Test
	void whileSomebodyWhoHasPaidGetsAsFarAsStripe() {
		Subscriber user = this.rows.entitledTo(50);
		this.rows.billedAsStripeCustomer(user, "cus_paying");

		HttpResponse<String> unavailable = manageBilling(user.token());

		assertThat(unavailable.statusCode()).isEqualTo(503);
		assertThat(unavailable.body()).isEmpty();
	}

	/**
	 * And so does somebody who cancelled. ADR-0018 drops them to the default tier and clears
	 * {@code stripe_subscription_id} while <em>keeping</em> {@code stripe_customer_id}, so their invoices and
	 * their card are still theirs to reach — which is the whole reason that column is kept, and the reason this
	 * endpoint asks about the customer rather than about the subscription or its status.
	 */
	@Test
	void andSoDoesSomebodyWhoCancelled() {
		Subscriber cancelled = this.rows.entitledTo(3);
		this.rows.billedAsStripeCustomer(cancelled, "cus_was_paying");

		assertThat(manageBilling(cancelled.token()).statusCode()).isEqualTo(503);
	}

	/**
	 * And so does somebody in dunning, who is the person most likely to want this: ADR-0018 has the 402 copy
	 * read "update your card" beside this very link, and a status gate here would close the door on them.
	 */
	@Test
	void andSoDoesSomebodyWhoseCardIsFailing() {
		Subscriber dunning = this.rows.entitledTo(50);
		this.rows.billedAsStripeCustomer(dunning, "cus_past_due");
		this.rows.statusIs(dunning, "past_due");

		assertThat(manageBilling(dunning.token()).statusCode()).isEqualTo(503);
	}

	@Test
	void andNobodyManagesAnythingWithoutATokenAtAll() {
		HttpResponse<String> refused = Http.send(HttpRequest.newBuilder(uri())
				.timeout(TIMEOUT)
				.POST(HttpRequest.BodyPublishers.noBody())
				.build());

		assertThat(refused.statusCode()).isEqualTo(401);
	}

	// --- the calls themselves ------------------------------------------------------------------------------

	private HttpResponse<String> manageBilling(String token) {
		return Http.send(HttpRequest.newBuilder(uri())
				.timeout(TIMEOUT)
				.header("Authorization", "Bearer " + token)
				.POST(HttpRequest.BodyPublishers.noBody())
				.build());
	}

	private URI uri() {
		return URI.create("http://localhost:" + this.port + "/api/portal");
	}

	@LocalServerPort
	private int port;

	@Autowired
	private JdbcTemplate db;

	private Subscribers rows;

	private static final Duration TIMEOUT = Duration.ofSeconds(20);

}
