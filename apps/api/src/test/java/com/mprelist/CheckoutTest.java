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

/**
 * {@code POST /api/checkout} as a route (T19, #29): who may call it, and what each refusal looks like from
 * outside.
 *
 * <p><strong>No Stripe key is configured here, and that is what makes the suite possible.</strong> Everything
 * below is a decision taken before Stripe would be asked — a plan that is not on sale, a body that cannot be
 * read, a caller with no token — plus the one answer for when Stripe cannot be asked at all, which is the
 * state an unconfigured key produces. What we *send* Stripe when it is configured is
 * {@code CheckoutSessionTest}, against a stub on a loopback port; a `200` over a real port would need a live
 * Stripe account, and that is the click-through's (slice C, step 4).
 *
 * <p><strong>Said as a property rather than left to the environment</strong>, which is the difference between
 * a suite that is about an unconfigured key and one that merely runs on a machine that has none. The
 * click-through tells you to export {@code MPRELIST_STRIPE_SECRET_KEY} to walk slice C, {@code .env} now
 * holds one for {@code bootRun}, and test workers inherit both — without this line every assertion below
 * would be answered by a <em>real</em> Stripe account, and `aPlanOnSaleGetsAsFarAsStripe` would open a live
 * Checkout session rather than being refused for want of a key.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = "mprelist.stripe.secret-key=")
@Import(PostgresFromCompose.class)
class CheckoutTest {

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
	void oneTierOnSaleAndOneDraft() {
		this.db.update("delete from tier where code not in ('free', 'pro', 'power')");
		this.db.update("update tier set stripe_price_id = null, published = false");
		this.db.update("update tier set stripe_price_id = 'price_pro', published = true where code = 'pro'");
		this.db.update("insert into tier (code, name, relist_quota_per_period, max_marktplaats_accounts, "
				+ "stripe_price_id, published) values ('starter', 'starter', 0, 1, 'price_starter', false)");
	}

	@Test
	void aTierNobodySellsIsNotSomethingToBuy() {
		HttpResponse<String> refused = buy("nonesuch");

		assertThat(refused.statusCode()).isEqualTo(404);
		assertThat(refused.body()).isEmpty();
	}

	/**
	 * Including the free tier, which is not a thing a buyer chooses — it has no Price, so it is not in the
	 * list this route buys from at all.
	 */
	@Test
	void andNeitherIsTheFreeOne() {
		assertThat(buy("free").statusCode()).isEqualTo(404);
	}

	/**
	 * And neither is a draft: the row ADR-0019's webhook creates at quota 0 for a Price nobody has decided
	 * about (T51, #82). It has a Price, so `published` is the only thing between it and somebody paying for
	 * nothing.
	 */
	@Test
	void norADraftNobodyHasPublished() {
		assertThat(buy("starter").statusCode()).isEqualTo(404);
	}

	/**
	 * A plan that *is* on sale gets as far as Stripe, which is not configured here — and the two refusals are
	 * different statuses on purpose: one says the plan is gone, the other says come back in a minute.
	 */
	@Test
	void aPlanOnSaleGetsAsFarAsStripe() {
		HttpResponse<String> unavailable = buy("pro");

		assertThat(unavailable.statusCode()).isEqualTo(503);
		assertThat(unavailable.body()).isEmpty();
	}

	@Test
	void aBodyThatNamesNoTierIsNotARequestThisApiCanRead() {
		assertThat(post("{}").statusCode()).isEqualTo(400);
		assertThat(post("{\"tierCode\":\"  \"}").statusCode()).isEqualTo(400);
	}

	@Test
	void andNeitherIsOneThatIsNotJsonAtAll() {
		HttpResponse<String> refused = post("not json");

		assertThat(refused.statusCode()).isEqualTo(400);
		// Nothing to parse, which is the contract's rule for a 4xx that is not a denial — and in particular no
		// `reason`, since a client reads the presence of one as meaning the gate turned the user away.
		assertThat(refused.body()).isEmpty();
	}

	@Test
	void andNobodyBuysAnythingWithoutATokenAtAll() {
		HttpResponse<String> refused = Http.send(HttpRequest.newBuilder(uri())
				.timeout(TIMEOUT)
				.header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString("{\"tierCode\":\"pro\"}", UTF_8))
				.build());

		assertThat(refused.statusCode()).isEqualTo(401);
	}

	// --- the calls themselves ------------------------------------------------------------------------------

	private HttpResponse<String> buy(String tierCode) {
		return post("{\"tierCode\":\"" + tierCode + "\"}");
	}

	private HttpResponse<String> post(String body) {
		return Http.send(HttpRequest.newBuilder(uri())
				.timeout(TIMEOUT)
				.header("Authorization", "Bearer " + IDP.token())
				.header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(body, UTF_8))
				.build());
	}

	private URI uri() {
		return URI.create("http://localhost:" + this.port + "/api/checkout");
	}

	@LocalServerPort
	private int port;

	@Autowired
	private JdbcTemplate db;

	private static final Duration TIMEOUT = Duration.ofSeconds(20);

}
