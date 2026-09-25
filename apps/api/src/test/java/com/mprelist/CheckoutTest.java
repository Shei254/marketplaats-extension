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
		this.rows = new Subscribers(this.db, IDP, "checkout-suite-");
		this.rows.nobodyHasRelistedYet();
		this.db.update("delete from tier where code not in ('free', 'pro', 'power')");
		TierPrices.nothingIsPriced(this.db);
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro");
		this.db.update("update tier set published = true where code = 'pro'");
		this.db.update("insert into tier (code, name, relist_quota_per_period, max_marktplaats_accounts, "
				+ "published) values ('starter', 'starter', 0, 1, false)");
		TierPrices.soldByTheMonth(this.db, "starter", "price_starter");
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
		assertThat(post("{\"tierCode\":\"  \",\"interval\":\"month\"}").statusCode()).isEqualTo(400);
	}

	/**
	 * And neither is one that names no rhythm, which is as required as the code since T62 (#128).
	 *
	 * <p>A tier may be sold monthly and annually, so a request naming only the tier names two prices — and
	 * defaulting to either would charge somebody a rhythm they did not pick. It is a `400` rather than a `404`
	 * because it is a request this API could not read, not a plan that is not for sale.
	 */
	@Test
	void andNeitherIsOneThatNamesNoRhythm() {
		assertThat(post("{\"tierCode\":\"pro\"}").statusCode()).isEqualTo(400);
		assertThat(post("{\"tierCode\":\"pro\",\"interval\":\"  \"}").statusCode()).isEqualTo(400);
	}

	/**
	 * A rhythm the tier is not sold at is `404`, like a tier nobody sells — which is what a client holding
	 * yesterday's cards gets when a plan stops offering annual, and is nobody's error.
	 */
	@Test
	void aRhythmThisTierIsNotSoldAtIsNotSomethingToBuyEither() {
		HttpResponse<String> refused = buy("pro", "year");

		assertThat(refused.statusCode()).isEqualTo(404);
		assertThat(refused.body()).isEmpty();
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
				.POST(HttpRequest.BodyPublishers.ofString("{\"tierCode\":\"pro\",\"interval\":\"month\"}", UTF_8))
				.build());

		assertThat(refused.statusCode()).isEqualTo(401);
	}

	// --- somebody already paying (T83) --------------------------------------------------------------------

	/**
	 * Somebody Stripe is already billing is refused a second subscription, and told why: it is a statement
	 * about them — the one kind of {@code 4xx} that carries a {@code reason} — and what to do about it is the
	 * Customer Portal, where a switch is prorated rather than charged twice.
	 *
	 * <p>{@code 409} and not {@code 503}, although no Stripe is configured here: the answer is read off our own
	 * mirror before Stripe would be asked.
	 */
	@Test
	void somebodyAlreadyPayingIsSentToManageWhatTheyHave() {
		Subscriber payer = this.rows.entitledTo(50);
		this.rows.billedAsStripeCustomer(payer, "cus_paying");
		this.rows.mirroredFromStripe(payer);

		HttpResponse<String> refused = buy(payer.token(), "pro", "month");

		assertThat(refused.statusCode()).isEqualTo(409);
		assertThat(refused.body()).isEqualTo("{\"reason\":\"ALREADY_PAYING\"}");
	}

	/**
	 * While somebody who cancelled is not paying: ADR-0018 cleared their subscription and kept their customer,
	 * so they get as far as Stripe — unconfigured here, hence the {@code 503} — to buy again as themselves.
	 */
	@Test
	void whileSomebodyWhoCancelledMayBuyAgain() {
		Subscriber returning = this.rows.entitledTo(3);
		this.rows.billedAsStripeCustomer(returning, "cus_returning");

		assertThat(buy(returning.token(), "pro", "month").statusCode()).isEqualTo(503);
	}

	// --- the calls themselves ------------------------------------------------------------------------------

	private HttpResponse<String> buy(String tierCode) {
		return buy(tierCode, "month");
	}

	/** Which plan, and at which rhythm — a tier may be sold at more than one since T62 (#128). */
	private HttpResponse<String> buy(String tierCode, String interval) {
		return post("{\"tierCode\":\"" + tierCode + "\",\"interval\":\"" + interval + "\"}");
	}

	private HttpResponse<String> buy(String token, String tierCode, String interval) {
		return post(token, "{\"tierCode\":\"" + tierCode + "\",\"interval\":\"" + interval + "\"}");
	}

	private HttpResponse<String> post(String body) {
		return post(IDP.token(), body);
	}

	private HttpResponse<String> post(String token, String body) {
		return Http.send(HttpRequest.newBuilder(uri())
				.timeout(TIMEOUT)
				.header("Authorization", "Bearer " + token)
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

	private Subscribers rows;

	private static final Duration TIMEOUT = Duration.ofSeconds(20);

}
