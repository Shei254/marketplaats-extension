package com.mprelist;

import static java.nio.charset.StandardCharsets.UTF_8;
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
 * {@code POST /api/plan-switch} and its preview as routes (T85, ADR-0036): who may call them, and what each
 * refusal looks like from outside.
 *
 * <p>No Stripe key, for {@code CheckoutTest}'s reason: every answer here is decided before Stripe would be
 * asked, or is the {@code 503} for when it cannot be. What is sent to Stripe is {@code PlanSwitchTest}.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = "mprelist.stripe.secret-key=")
@Import(PostgresFromCompose.class)
class PlanSwitchRouteTest {

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
	void oneTierOnSale() {
		this.rows = new Subscribers(this.db, IDP, "switch-suite-");
		this.rows.nobodyHasRelistedYet();
		this.db.update("delete from tier where code not in ('free', 'pro', 'power')");
		TierPrices.nothingIsPriced(this.db);
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro");
		this.db.update("update tier set published = true where code = 'pro'");
	}

	/** Nothing to switch: T83's `409` the other way round, and Checkout is theirs. */
	@Test
	void somebodyStripeIsNotBillingIsToldSo() {
		Subscriber free = this.rows.entitledTo(3);

		for (String path : new String[] { "/api/plan-switch", "/api/plan-switch/preview" }) {
			HttpResponse<String> refused = post(path, free.token(), "pro", "month");

			assertThat(refused.statusCode()).as(path).isEqualTo(409);
			assertThat(refused.body()).as(path).isEqualTo("{\"reason\":\"NOT_PAYING\"}");
		}
	}

	@Test
	void aPayerAskingForAPlanNobodySellsIsNotSomethingToSwitchTo() {
		Subscriber payer = aPayer();

		HttpResponse<String> refused = post("/api/plan-switch", payer.token(), "nonesuch", "month");

		assertThat(refused.statusCode()).isEqualTo(404);
		assertThat(refused.body()).isEmpty();
	}

	/** A payer, a plan on sale, and no Stripe to ask: the one refusal a retry fixes. */
	@Test
	void aPayerAskingForAPlanOnSaleGetsAsFarAsStripe() {
		Subscriber payer = aPayer();

		assertThat(post("/api/plan-switch/preview", payer.token(), "pro", "month").statusCode()).isEqualTo(503);
		assertThat(post("/api/plan-switch", payer.token(), "pro", "month").statusCode()).isEqualTo(503);
	}

	@Test
	void aBodyNamingNoRhythmIsNotARequestThisCanRead() {
		HttpResponse<String> refused = send("/api/plan-switch", aPayer().token(), "{\"tierCode\":\"pro\"}");

		assertThat(refused.statusCode()).isEqualTo(400);
		assertThat(refused.body()).isEmpty();
	}

	@Test
	void andNeitherIsOneThatIsNotJson() {
		assertThat(send("/api/plan-switch/preview", aPayer().token(), "pro please").statusCode()).isEqualTo(400);
	}

	@Test
	void aCallerWithNoTokenIsNotAskedWhatTheyWant() {
		HttpResponse<String> refused = Http.send(HttpRequest.newBuilder(uri("/api/plan-switch"))
				.timeout(TIMEOUT)
				.header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString("{\"tierCode\":\"pro\",\"interval\":\"month\"}", UTF_8))
				.build());

		assertThat(refused.statusCode()).isEqualTo(401);
	}

	// --- the calls themselves ------------------------------------------------------------------------------

	private Subscriber aPayer() {
		Subscriber payer = this.rows.entitledTo(50);
		this.rows.billedByStripe(payer, "sub_switching", "price_pro");
		return payer;
	}

	private HttpResponse<String> post(String path, String token, String tierCode, String interval) {
		return send(path, token, "{\"tierCode\":\"" + tierCode + "\",\"interval\":\"" + interval + "\"}");
	}

	private HttpResponse<String> send(String path, String token, String body) {
		return Http.send(HttpRequest.newBuilder(uri(path))
				.timeout(TIMEOUT)
				.header("Authorization", "Bearer " + token)
				.header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(body, UTF_8))
				.build());
	}

	private URI uri(String path) {
		return URI.create("http://localhost:" + this.port + path);
	}

	@LocalServerPort
	private int port;

	@Autowired
	private JdbcTemplate db;

	private Subscribers rows;

	private static final Duration TIMEOUT = Duration.ofSeconds(20);

}
