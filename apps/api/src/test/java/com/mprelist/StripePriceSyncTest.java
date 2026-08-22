package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import tools.jackson.databind.json.JsonMapper;

/**
 * The Price → Tier sync (#82, T51): a Price created in the Stripe dashboard becomes a tier in our catalog,
 * and the three things ADR-0019 says must not happen do not.
 *
 * <p>Driven over a real port with real signatures rather than by calling a bean, because two of the claims
 * are only true of the running application: that this one route is reachable <em>without a bearer token</em>,
 * which is a filter chain in another module, and that an event which is not signed by Stripe is refused,
 * which is the whole of the authentication on it. Every request below carries no token at all — so a chain
 * that stopped opening exactly this path would fail every test here with a 401 rather than in one place.
 *
 * <p>The events are hand-built here and signed by {@link StripeDeliveries} with the suite's own secret, which
 * is what Stripe's CLI and its servers both do. No Stripe account is involved and none is needed — what is
 * asserted is our end of a published algorithm. Whether a real Price arrives shaped like these is the
 * click-through's, and it is T22 (#28).
 *
 * <p>Not {@code @Transactional}: the application writes on its own connection. Each test starts from the
 * catalog {@code V2__seed_tier_catalog.sql} left behind, restored by {@link #aCatalogNobodyHasSyncedYet()}.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = "mprelist.stripe.webhook-secret=" + StripePriceSyncTest.SECRET)
@Import(PostgresFromCompose.class)
class StripePriceSyncTest {

	/** Shaped like Stripe's, and a fake: `stripe listen` prints a real one per session and it is never committed. */
	static final String SECRET = "whsec_thisIsNotARealSigningSecret0123456789";

	@LocalServerPort
	private int port;

	@Autowired
	private JdbcTemplate db;

	@BeforeEach
	void aCatalogNobodyHasSyncedYet() {
		this.stripe = new StripeDeliveries(this.port, SECRET);
		this.db.update("delete from tier where code not in ('free', 'pro', 'power')");
		TierPrices.nothingIsPriced(this.db);
		this.db.update("update tier set name = 'Pro', relist_quota_per_period = 50 where code = 'pro'");
		this.db.update("update tier set name = 'Power', relist_quota_per_period = 200 where code = 'power'");
	}

	// --- What a tagged Price does to the tier it names -------------------------------------------------

	@Test
	void aPriceTaggedProFillsInTheSeededTier() {
		assertThat(signedPost(priceEvent("price.created", "price_pro_monthly", "pro", null)).statusCode())
				.isEqualTo(200);

		assertThat(TierPrices.only(this.db, "pro")).isEqualTo("price_pro_monthly");
		assertThat(publishedIs("pro")).isTrue();
	}

	/**
	 * And leaves the 50 alone, which is the rule ADR-0019 states and the one this whole ticket is arranged
	 * around: money is Stripe's, limits are ours, and a webhook that could rewrite a quota would make the
	 * dashboard the place two of them are decided.
	 */
	@Test
	void andNeverTouchesTheQuota() {
		this.db.update("update tier set relist_quota_per_period = 7 where code = 'pro'");

		signedPost(priceEvent("price.created", "price_pro_monthly", "pro", null));

		assertThat(quotaOf("pro")).isEqualTo(7);
	}

	/**
	 * A Price with no nickname leaves the tier called what an operator called it. Stripe's nickname is
	 * optional and usually unset, so the alternative — writing it through unconditionally — renames Pro to
	 * nothing on the first sync.
	 */
	@Test
	void andLeavesTheTierNamedWhatItWasNamed() {
		signedPost(priceEvent("price.created", "price_pro_monthly", "pro", null));

		assertThat(stringOf("pro", "name")).isEqualTo("Pro");
	}

	@Test
	void unlessThePriceGivesOneOfItsOwn() {
		signedPost(priceEvent("price.created", "price_pro_monthly", "pro", "Pro, monthly"));

		assertThat(stringOf("pro", "name")).isEqualTo("Pro, monthly");
	}

	// --- What an unknown tag does ---------------------------------------------------------------------

	@Test
	void aPriceTaggedWithACodeNoTierCarriesIsADraft() {
		assertThat(signedPost(priceEvent("price.created", "price_starter", "starter", null)).statusCode())
				.isEqualTo(200);

		assertThat(quotaOf("starter")).isZero();
		assertThat(publishedIs("starter")).isFalse();
		assertThat(TierPrices.only(this.db, "starter")).isEqualTo("price_starter");
	}

	/**
	 * A draft is unbuyable and stays that way until somebody says what it grants (T53, #84). Asserted as the
	 * pair {@code GET /api/plans} (#80) will read, because a draft that were published at quota 0 would be a
	 * plan card offering nothing for money.
	 */
	@Test
	void andIsNotOnSaleEvenThoughItHasAPrice() {
		signedPost(priceEvent("price.created", "price_starter", "starter", null));

		assertThat(this.db.queryForList("select code from tier where published", String.class)).isEmpty();
	}

	@Test
	void andIsNamedAfterItsOwnCodeUntilSomebodyRenamesIt() {
		signedPost(priceEvent("price.created", "price_starter", "starter", null));

		assertThat(stringOf("starter", "name")).isEqualTo("starter");
	}

	// --- What is ignored ------------------------------------------------------------------------------

	/**
	 * ADR-0019: "A Price without one is not a plan." Stripe Prices get created for one-offs, coupons and
	 * experiments, and a sync that adopted all of them would turn a billing experiment into a tier — so an
	 * untagged Price leaves the catalog exactly as it was, and the endpoint still answers 200.
	 */
	@Test
	void aPriceWithNoTierCodeIsNotAPlan() {
		assertThat(signedPost(priceEvent("price.created", "price_one_off", null, "A one-off")).statusCode())
				.isEqualTo(200);

		assertThat(codesInTheCatalog()).containsExactlyInAnyOrder("free", "pro", "power");
		assertThat(this.db.queryForList("select code from tier join tier_price on tier.id = tier_price.tier_id",
				String.class))
				.isEmpty();
	}

	/**
	 * An endpoint hears about everything it is subscribed to, and this ticket handles two types. The rest are
	 * answered 200 rather than refused: a non-2xx would put the endpoint into a retry loop over events it will
	 * never act on, which is the state that hides the ones that matter.
	 */
	@Test
	void andAnEventThisTicketDoesNotHandleIsAnsweredRatherThanRetried() {
		String subscription = event("customer.subscription.updated",
				new LinkedHashMap<>(Map.of("id", "sub_123", "status", "active")));

		assertThat(signedPost(subscription).statusCode()).isEqualTo(200);
		assertThat(codesInTheCatalog()).containsExactlyInAnyOrder("free", "pro", "power");
	}

	/**
	 * And a Price that does not recur is not a plan either, however it is tagged (T62, #128).
	 *
	 * <p>A tier's prices are told apart by their rhythm now that it may have several, so a one-off has nothing
	 * to be filed under — and adopting one was always wrong: it would have become a tier whose Checkout session
	 * could never be opened, since this product sells subscriptions. Before the rhythm was stored there was
	 * nothing to notice that with.
	 */
	@Test
	void andNeitherIsOneThatDoesNotRecur() {
		assertThat(signedPost(priceEvent("price.created", "price_lifetime", "pro", "Lifetime", null))
				.statusCode()).isEqualTo(200);

		assertThat(TierPrices.of(this.db, "pro")).isEmpty();
	}

	// --- What a second rhythm does (T62, #128) --------------------------------------------------------

	/**
	 * A second Price tagged with the same code at a <em>different</em> rhythm is a second way to buy one plan,
	 * not a second plan and not a replacement.
	 *
	 * <p>This is the whole of the ticket at the sync level. Before it, `tier.stripe_price_id` was one column,
	 * so the annual Price overwrote the monthly one and Pro silently stopped being sold by the month —
	 * ADR-0019 wrote that down as the thing its own `UNIQUE` constraint blocked.
	 */
	@Test
	void aSecondPriceAtAnotherRhythmIsAnotherWayToBuyTheSamePlan() {
		signedPost(priceEvent("price.created", "price_pro_monthly", "pro", null, "month"));

		signedPost(priceEvent("price.created", "price_pro_yearly", "pro", null, "year"));

		assertThat(TierPrices.of(this.db, "pro"))
				.containsExactlyInAnyOrder("price_pro_monthly", "price_pro_yearly");
		assertThat(TierPrices.intervalsOf(this.db, "pro")).containsExactly("month", "year");
	}

	/** And the tier is still one row, with one quota and one name — which is what "one plan" means. */
	@Test
	void andTheTierIsStillOneRowWithOneQuota() {
		signedPost(priceEvent("price.created", "price_pro_monthly", "pro", null, "month"));
		signedPost(priceEvent("price.created", "price_pro_yearly", "pro", null, "year"));

		assertThat(codesInTheCatalog()).containsExactlyInAnyOrder("free", "pro", "power");
		assertThat(quotaOf("pro")).isEqualTo(50);
	}

	/**
	 * While a second Price at the <em>same</em> rhythm replaces that rhythm's, which is repricing — and leaves
	 * the other rhythm alone, which the single column could not do.
	 */
	@Test
	void whileASecondPriceAtTheSameRhythmRepricesThatOneAndLeavesTheOtherAlone() {
		signedPost(priceEvent("price.created", "price_pro_monthly", "pro", null, "month"));
		signedPost(priceEvent("price.created", "price_pro_yearly", "pro", null, "year"));

		signedPost(priceEvent("price.created", "price_pro_monthly_v2", "pro", null, "month"));

		assertThat(TierPrices.of(this.db, "pro"))
				.containsExactlyInAnyOrder("price_pro_monthly_v2", "price_pro_yearly");
	}

	/**
	 * And adding a rhythm never puts a withdrawn plan back on sale. Publishing happens once, on the first price
	 * to land on a tier that grants something; an operator who took Pro off the cards did so deliberately.
	 */
	@Test
	void andAddingARhythmDoesNotRepublishAWithdrawnPlan() {
		signedPost(priceEvent("price.created", "price_pro_monthly", "pro", null, "month"));
		this.db.update("update tier set published = false where code = 'pro'");

		signedPost(priceEvent("price.created", "price_pro_yearly", "pro", null, "year"));

		assertThat(publishedIs("pro")).isFalse();
	}

	// --- What happens the second time -----------------------------------------------------------------

	/**
	 * Stripe Prices are immutable, so changing what Pro costs means creating a second Price and repointing the
	 * tier at it (ADR-0019). That is this event, and the tier follows.
	 */
	@Test
	void aSecondPriceForTheSameTierRepointsIt() {
		signedPost(priceEvent("price.created", "price_pro_monthly", "pro", null));

		signedPost(priceEvent("price.created", "price_pro_monthly_v2", "pro", null));

		assertThat(TierPrices.only(this.db, "pro")).isEqualTo("price_pro_monthly_v2");
	}

	/**
	 * And does not put a tier an operator took off sale back on it. Publication rises once, when a tier with a
	 * quota takes its first Price; after that it is the admin's (T53) and Stripe has nothing to say about it.
	 */
	@Test
	void andDoesNotRepublishATierSomebodyUnpublished() {
		signedPost(priceEvent("price.created", "price_pro_monthly", "pro", null));
		this.db.update("update tier set published = false where code = 'pro'");

		signedPost(priceEvent("price.updated", "price_pro_monthly", "pro", "Pro, monthly"));

		assertThat(publishedIs("pro")).isFalse();
		assertThat(stringOf("pro", "name")).isEqualTo("Pro, monthly");
	}

	/**
	 * Stripe delivers at least once, so the same event arriving twice has to leave the same row. It does,
	 * because an upsert on the tier code says the same thing however often it is said — which is why this
	 * ticket keeps no log of event ids and #30's subscription mirror will have to.
	 */
	@Test
	void andTheSameEventTwiceIsTheSameRowOnce() {
		String repeated = priceEvent("price.created", "price_starter", "starter", null);

		signedPost(repeated);
		signedPost(repeated);

		assertThat(this.db.queryForObject("select count(*) from tier where code = 'starter'", Integer.class))
				.isEqualTo(1);
	}

	/**
	 * A Price belongs to one tier: {@code tier_price.stripe_price_id} is unique, so adopting one that another tier
	 * holds would either fail the constraint or quietly leave that tier with nothing to sell. Neither is a
	 * choice a webhook should make, so nothing changes and the operator is told.
	 */
	@Test
	void aPriceAnotherTierHoldsIsLeftWhereItIs() {
		signedPost(priceEvent("price.created", "price_pro_monthly", "pro", null));

		assertThat(signedPost(priceEvent("price.updated", "price_pro_monthly", "power", null)).statusCode())
				.isEqualTo(200);

		assertThat(TierPrices.only(this.db, "pro")).isEqualTo("price_pro_monthly");
		assertThat(TierPrices.only(this.db, "power")).isNull();
		assertThat(publishedIs("power")).isFalse();
	}

	/**
	 * "No free tier" is quota 0 on a tier (ADR-0019), and a tier granting nothing is not something to put on
	 * sale because a Price landed on it. Publication needs both halves.
	 */
	@Test
	void aTierThatGrantsNothingIsNotPublishedByAPriceLandingOnIt() {
		this.db.update("update tier set relist_quota_per_period = 0 where code = 'pro'");

		signedPost(priceEvent("price.created", "price_pro_monthly", "pro", null));

		assertThat(TierPrices.only(this.db, "pro")).isEqualTo("price_pro_monthly");
		assertThat(publishedIs("pro")).isFalse();
	}

	// --- The signature, which is the whole of the authentication --------------------------------------

	@Test
	void anEventCarryingNoSignatureIsRefused() {
		HttpResponse<String> refused = this.stripe
				.deliveredUnsigned(priceEvent("price.created", "price_pro_monthly", "pro", null));

		assertThat(refused.statusCode()).isEqualTo(400);
		assertThat(TierPrices.only(this.db, "pro")).isNull();
	}

	/**
	 * The one that matters: a stranger who knows the shape of the event but not the secret cannot publish a
	 * tier into the catalog every subscriber is priced by.
	 */
	@Test
	void andOneSignedWithSomeOtherSecretIsRefused() {
		String payload = priceEvent("price.created", "price_pro_monthly", "pro", null);

		HttpResponse<String> refused = this.stripe.deliveredSignedWith("whsec_someoneElsesSecret", payload);

		assertThat(refused.statusCode()).isEqualTo(400);
		assertThat(TierPrices.only(this.db, "pro")).isNull();
	}

	/**
	 * And a genuine event replayed a day later is refused too, which is what the timestamp in the header is
	 * for — a signature with no window on it is a request anybody who ever saw one can send again.
	 */
	@Test
	void andAGenuineOneReplayedTomorrowIsRefused() {
		String payload = priceEvent("price.created", "price_pro_monthly", "pro", null);
		Instant yesterday = Instant.now().minus(1, ChronoUnit.DAYS);

		HttpResponse<String> refused = this.stripe.deliveredAsIfSentAt(yesterday, payload);

		assertThat(refused.statusCode()).isEqualTo(400);
		assertThat(TierPrices.only(this.db, "pro")).isNull();
	}

	/**
	 * Signed and unreadable is answered the same way, and is the one pairing that should never happen: it says
	 * our secret is held by something that is not Stripe.
	 */
	@Test
	void andSomethingSignedThatIsNotJsonAtAll() {
		assertThat(signedPost("not json, but signed").statusCode()).isEqualTo(400);
	}

	/**
	 * The route is open to Stripe and to nobody else — every other route still needs a token, which is what
	 * says the chain opened one path rather than a prefix.
	 */
	@Test
	void andTheRestOfTheApiIsStillClosed() {
		HttpResponse<String> refused = Http.send(HttpRequest.newBuilder(uri("/api/me")).GET().build());

		assertThat(refused.statusCode()).isEqualTo(401);
	}

	/** A GET to the webhook is not the webhook, so it is refused like any other route nobody may reach. */
	@Test
	void andSoIsTheWebhookPathItselfToAnythingButAPost() {
		HttpResponse<String> refused = Http.send(HttpRequest.newBuilder(uri(WEBHOOK)).GET().build());

		assertThat(refused.statusCode()).isEqualTo(401);
	}

	// --- The invariant the schema now carries ---------------------------------------------------------

	/**
	 * Published means buyable and buying needs a Price, so the pair is unwriteable rather than merely agreed
	 * between the two readers of it. It is what stops T53's publish button from offering a tier whose Checkout
	 * session could not be opened.
	 */
	@Test
	void aTierCannotBePublishedWithoutAPrice() {
		assertThatThrownBy(() -> this.db.update("update tier set published = true where code = 'pro'"))
				.hasMessageContaining("tier_is_published_only_with_a_price");
	}

	// --- The suite's own machinery --------------------------------------------------------------------

	/** An event as Stripe sends one, cut down to the fields ADR-0019 names. */
	private static String priceEvent(String type, String priceId, String tierCode, String nickname) {
		return priceEvent(type, priceId, tierCode, nickname, "month");
	}

	/**
	 * @param interval how often the Price recurs, which since T62 (#128) is what tells a tier's prices apart
	 * — and {@code null} for a one-off, which is not a plan however it is tagged
	 */
	private static String priceEvent(String type, String priceId, String tierCode, String nickname,
			String interval) {
		Map<String, Object> price = new LinkedHashMap<>();
		price.put("id", priceId);
		price.put("object", "price");
		price.put("active", true);
		price.put("nickname", nickname);
		price.put("metadata", tierCode == null ? Map.of() : Map.of("tier_code", tierCode));
		if (interval != null) {
			price.put("recurring", Map.of("interval", interval));
		}
		return event(type, price);
	}

	private static String event(String type, Map<String, Object> object) {
		Map<String, Object> event = new HashMap<>();
		event.put("id", "evt_" + type.replace('.', '_'));
		event.put("object", "event");
		event.put("type", type);
		event.put("data", Map.of("object", object));
		return JSON.writeValueAsString(event);
	}

	private HttpResponse<String> signedPost(String payload) {
		return this.stripe.delivered(payload);
	}

	private URI uri(String path) {
		return URI.create("http://localhost:" + this.port + path);
	}

	private java.util.List<String> codesInTheCatalog() {
		return this.db.queryForList("select code from tier", String.class);
	}

	private String stringOf(String code, String column) {
		return this.db.queryForObject("select " + column + " from tier where code = ?", String.class, code);
	}

	private int quotaOf(String code) {
		return this.db.queryForObject("select relist_quota_per_period from tier where code = ?", Integer.class,
				code);
	}

	private boolean publishedIs(String code) {
		return this.db.queryForObject("select published from tier where code = ?", Boolean.class, code);
	}

	/** The deliveries this suite makes, signed with the secret above. */
	private StripeDeliveries stripe;

	private static final String WEBHOOK = "/api/stripe/webhook";

	private static final JsonMapper JSON = JsonMapper.builder().build();

}
