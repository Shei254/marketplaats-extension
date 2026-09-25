package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

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

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The subscription mirror (#30, T20): what Stripe says about a subscription becomes the plan somebody is on,
 * and the thing that makes a payment an entitlement.
 *
 * <p>Driven as a lifecycle rather than as arranged rows. Every subscriber below is put on their tier by the
 * same event Stripe sends when a Checkout completes, and everything that happens to them afterwards — a
 * renewal, a card that starts failing, a cancellation — is the event Stripe sends for that. So the assertions
 * are about a sequence a real account goes through, and a mirror that wrote the right row from the wrong event
 * has nowhere to hide. The one thing arranged directly is the {@code stripe_price_id} on the seeded
 * {@code pro}, which is otherwise T51's webhook to write.
 *
 * <p>Over a real port with real signatures for {@link StripePriceSyncTest}'s reasons: this route is opened by
 * name in a filter chain in another module and is authenticated by a signature rather than a token, and every
 * delivery here carries no token at all.
 *
 * <p><strong>Not verified here: no Stripe account has ever sent one of these.</strong> Every event is
 * hand-built and hand-signed, which is the right way round for our end of a published algorithm and says
 * nothing about whether a real subscription arrives shaped like these. That is the click-through's, slice C
 * steps 5 to 8.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "mprelist.stripe.webhook-secret=" + StripeSubscriptionMirrorTest.SECRET,
				// Nothing here holds a reservation, and a job waking up mid-suite is noise in a log somebody
				// will one day read to find out why a mirror did not apply.
				"mprelist.reconciliation.interval=24h" })
@Import(PostgresFromCompose.class)
class StripeSubscriptionMirrorTest {

	/** Shaped like Stripe's, and a fake: `stripe listen` prints a real one per session and it is never committed. */
	static final String SECRET = "whsec_thisIsNotTheOtherSuitesSecret98765";

	/** In a field initialiser for {@link DynamicPropertySource}'s sake — see {@link ResourceServerTest}. */
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
	void nobodyHasEverPaid() {
		this.stripe = new StripeDeliveries(this.port, SECRET);
		// Accounts first, which takes their subscriptions with them.
		this.db.update("delete from app_user");
		this.db.update("delete from tier where code not in ('free', 'pro', 'power')");
		TierPrices.nothingIsPriced(this.db);
		// What T51's webhook writes when the Price is created in the dashboard (#82), arranged here because
		// this suite is about what happens *after* somebody buys it.
		TierPrices.soldByTheMonth(this.db, "pro", PRO_PRICE);
		this.db.update("update tier set published = true where code = 'pro'");
	}

	// --- a subscription that starts ---------------------------------------------------------------------

	@Test
	void aSubscriptionThatStartsPutsTheBuyerOnTheTierTheyPaidFor() {
		Account buyer = whoJustSignedIn();

		assertThat(this.stripe.delivered(started(subscriptionOf(buyer))).statusCode()).isEqualTo(200);

		assertThat(planOf(buyer)).containsEntry("tier", "pro").containsEntry("status", "active");
	}

	/**
	 * And the window becomes Stripe's, which is what {@code resetAt} then answers with. A payer's window is
	 * never rolled by this application (#20) — a closed one means a webhook has not arrived, and moving it
	 * would grant a month nobody was billed for — so this event is the only thing that ever sets it.
	 */
	@Test
	void andTheWindowBecomesTheBillingPeriodStripeReports() {
		Account buyer = whoJustSignedIn();
		Sub bought = subscriptionOf(buyer);

		this.stripe.delivered(started(bought));

		assertThat(windowOf(buyer)).isEqualTo(List.of(utc(bought.periodStart()), utc(bought.periodEnd())));
	}

	/**
	 * Both Stripe ids are stored, and the customer is the one that matters later: ADR-0018 keeps it through a
	 * cancellation so that resubscribing continues one billing history, and the Portal (T21, #31) has
	 * something to point at.
	 */
	@Test
	void andBothStripeIdsAreStoredSoTheSamePersonCanBeBilledAgain() {
		Account buyer = whoJustSignedIn();
		Sub bought = subscriptionOf(buyer);

		this.stripe.delivered(started(bought));

		assertThat(planOf(buyer)).containsEntry("stripe_customer_id", bought.customer())
				.containsEntry("stripe_subscription_id", bought.id());
	}

	/**
	 * And the Price it is billed at (T85): what a Plan switch changes, and what the site reads a payer's
	 * Rhythm from.
	 */
	@Test
	void andThePriceItIsBilledAt() {
		Account buyer = whoJustSignedIn();
		Sub bought = subscriptionOf(buyer);

		this.stripe.delivered(started(bought));

		assertThat(planOf(buyer)).containsEntry("stripe_price_id", bought.price());
	}

	/**
	 * A trial mirrors through with no special case anywhere, which is what ADR-0006 means by putting trials on
	 * the Price rather than in our code: {@code trialing} is an allowed status, so the subscriber is entitled
	 * to the tier they are trialing and the day it lapses Stripe says so with another event.
	 */
	@Test
	void aTrialIsMirroredLikeAnyOtherLiveSubscription() {
		Account buyer = whoJustSignedIn();

		this.stripe.delivered(started(subscriptionOf(buyer).as("trialing")));

		assertThat(planOf(buyer)).containsEntry("tier", "pro").containsEntry("status", "trialing");
	}

	/** A renewal is an update carrying the next window, and moving it is the whole of what it does. */
	@Test
	void aRenewalMovesTheWindowOn() {
		Account buyer = whoJustSignedIn();
		Sub bought = subscriptionOf(buyer);
		this.stripe.delivered(started(bought));
		Sub renewed = bought.forThePeriod(bought.periodEnd(), bought.periodEnd().plus(30, ChronoUnit.DAYS));

		this.stripe.delivered(changed(renewed, ANY_TIME.plusSeconds(60)));

		assertThat(windowOf(buyer)).isEqualTo(List.of(utc(renewed.periodStart()), utc(renewed.periodEnd())));
		assertThat(planOf(buyer)).containsEntry("tier", "pro").containsEntry("status", "active");
	}

	// --- a card that is failing (ADR-0018: dunning is not an end) ---------------------------------------

	/**
	 * The three dunning statuses keep the paid tier. Stripe is still retrying the card, the customer still
	 * believes they are a subscriber, and a successful retry gives the tier straight back — so the refusal
	 * they meet is {@code SUBSCRIPTION_INACTIVE} on the plan they bought, which is what makes that code mean
	 * "your payment didn't go through" and never "resubscribe".
	 */
	@Test
	void aCardThatIsFailingKeepsThePaidTierAndIsDenied() {
		for (String dunning : List.of("past_due", "unpaid", "incomplete")) {
			Account buyer = whoJustSignedIn();
			Sub bought = subscriptionOf(buyer);
			this.stripe.delivered(started(bought));

			this.stripe.delivered(changed(bought.as(dunning), ANY_TIME.plusSeconds(60)));

			assertThat(planOf(buyer)).containsEntry("tier", "pro").containsEntry("status", dunning);
		}
	}

	/**
	 * And the gate refuses them, which is the state the whole distinction is about — asserted through
	 * {@code /authorize} rather than off the row, because "denied" is a thing the gate decides and this suite
	 * would otherwise be claiming it on the strength of a status column.
	 */
	@Test
	void andTheGateRefusesThemWithTheCodeThatMeansAFailingCard() {
		Account buyer = whoJustSignedIn();
		Sub bought = subscriptionOf(buyer);
		this.stripe.delivered(started(bought));
		this.stripe.delivered(changed(bought.as("past_due"), ANY_TIME.plusSeconds(60)));

		HttpResponse<String> refused = new Relists(this.port)
				.authorizing(buyer.token(), "{\"adId\": \"an-ad-of-theirs\"}");

		assertThat(refused.statusCode()).isEqualTo(402);
		assertThat(Json.of(refused).get("reason").asString()).isEqualTo("SUBSCRIPTION_INACTIVE");
	}

	/** And a retry that succeeds gives it back, which is the reason the tier was left alone. */
	@Test
	void andARetryThatSucceedsIsBackToActiveOnTheSameTier() {
		Account buyer = whoJustSignedIn();
		Sub bought = subscriptionOf(buyer);
		this.stripe.delivered(started(bought));
		this.stripe.delivered(changed(bought.as("past_due"), ANY_TIME.plusSeconds(60)));

		this.stripe.delivered(changed(bought, ANY_TIME.plusSeconds(120)));

		assertThat(planOf(buyer)).containsEntry("tier", "pro").containsEntry("status", "active");
	}

	// --- a subscription that ends (ADR-0018) ------------------------------------------------------------

	/**
	 * The decision ADR-0018 exists for. Mirroring {@code canceled} onto a row still pointing at Pro would
	 * leave somebody who paid for three months with strictly less than a stranger who never paid — the gate
	 * checks status before quota, so every relist would be a 402 for ever. They become a free user instead.
	 */
	@Test
	void aCancellationPutsThemBackOnTheDefaultTierRatherThanLockingThemOut() {
		Account buyer = whoJustSignedIn();
		Sub bought = subscriptionOf(buyer);
		this.stripe.delivered(started(bought));

		this.stripe.delivered(ended(bought.as("canceled"), ANY_TIME.plusSeconds(60)));

		assertThat(planOf(buyer)).containsEntry("tier", "free").containsEntry("status", "active");
	}

	/**
	 * And they can relist again, which is ADR-0018's whole point: a subscription that ends is a downgrade and
	 * never a lockout, so the gate grants them the free tier's units rather than refusing them for ever.
	 */
	@Test
	void andTheyCanStillRelistOnTheFreeTierRatherThanBeingLockedOut() {
		Account buyer = whoJustSignedIn();
		Sub bought = subscriptionOf(buyer);
		this.stripe.delivered(started(bought));

		this.stripe.delivered(ended(bought.as("canceled"), ANY_TIME.plusSeconds(60)));

		assertThat(new Relists(this.port).authorizing(buyer.token(), "{\"adId\": \"an-ad-of-theirs\"}")
				.statusCode()).isEqualTo(200);
	}

	/**
	 * With the window back on our own monthly roll, anchored where it always was — on the day the account was
	 * provisioned, not on the day they cancelled. So {@code resetAt} keeps the date they have been planning
	 * around instead of jumping.
	 */
	@Test
	void andTheWindowGoesBackToTheMonthlyRollItWouldHaveBeenOn() {
		Account buyer = whoJustSignedIn();
		Sub bought = subscriptionOf(buyer);
		this.stripe.delivered(started(bought));

		this.stripe.delivered(ended(bought.as("canceled"), ANY_TIME.plusSeconds(60)));

		OffsetDateTime provisioned = Subscribers.utc(planOf(buyer), "created_at");
		assertThat(windowOf(buyer)).isEqualTo(List.of(provisioned, provisioned.plusMonths(1)));
	}

	/**
	 * The customer id is kept and the subscription id cleared, which is the pairing that makes resubscribing
	 * one billing history rather than two — {@code OpenCheckout} passes that customer back to Stripe. Clearing
	 * the subscription id is also what makes the window ours to roll again.
	 */
	@Test
	void andTheirCustomerIsKeptWhileTheSubscriptionIsGone() {
		Account buyer = whoJustSignedIn();
		Sub bought = subscriptionOf(buyer);
		this.stripe.delivered(started(bought));

		this.stripe.delivered(ended(bought.as("canceled"), ANY_TIME.plusSeconds(60)));

		assertThat(planOf(buyer)).containsEntry("stripe_customer_id", bought.customer())
				.containsEntry("stripe_subscription_id", null)
				.containsEntry("stripe_price_id", null);
	}

	/** A subscription whose first payment never completed ends the same way, and is the other terminal status. */
	@Test
	void andAnIncompleteThatExpiredIsTheSameEnd() {
		Account buyer = whoJustSignedIn();
		this.stripe.delivered(started(subscriptionOf(buyer).as("incomplete")));

		this.stripe.delivered(changed(subscriptionOf(buyer).as("incomplete_expired"), ANY_TIME.plusSeconds(60)));

		assertThat(planOf(buyer)).containsEntry("tier", "free").containsEntry("status", "active");
	}

	/**
	 * And somebody who cancels and comes back is the same customer buying again: the second subscription lands
	 * on the same row, which is what the kept customer id and the tag are both for.
	 */
	@Test
	void andSomebodyWhoResubscribesIsBackOnThePaidTier() {
		Account buyer = whoJustSignedIn();
		this.stripe.delivered(started(subscriptionOf(buyer)));
		this.stripe.delivered(ended(subscriptionOf(buyer).as("canceled"), ANY_TIME.plusSeconds(60)));

		this.stripe.delivered(started(subscriptionOf(buyer).called("sub_again"), ANY_TIME.plusSeconds(120)));

		assertThat(planOf(buyer)).containsEntry("tier", "pro").containsEntry("status", "active")
				.containsEntry("stripe_subscription_id", "sub_again");
	}

	// --- whose subscription it is -----------------------------------------------------------------------

	/**
	 * Our own tag is what makes a purchase land whichever order Stripe delivers its events in: it is on the
	 * subscription itself, so the first event about it already names the account — no earlier event, and no
	 * {@code checkout.session.completed}, has to have arrived first. Every test above relies on it; this one
	 * says so, by mirroring a subscription for a customer this application has never seen before.
	 */
	@Test
	void aSubscriptionCarryingOurTagNeedsNothingElseToFindTheAccount() {
		Account buyer = whoJustSignedIn();

		this.stripe.delivered(started(subscriptionOf(buyer).asCustomer("cus_never_seen")));

		assertThat(planOf(buyer)).containsEntry("tier", "pro")
				.containsEntry("stripe_customer_id", "cus_never_seen");
	}

	/**
	 * And an event with no tag at all is found by the customer it is for, which is what a subscription created
	 * in the Stripe dashboard for somebody we already bill looks like.
	 */
	@Test
	void andOneWithNoTagIsFoundByTheCustomerItIsFor() {
		Account buyer = whoJustSignedIn();
		this.stripe.delivered(started(subscriptionOf(buyer)));

		this.stripe.delivered(changed(subscriptionOf(buyer).untagged().as("past_due"), ANY_TIME.plusSeconds(60)));

		assertThat(planOf(buyer)).containsEntry("status", "past_due");
	}

	/**
	 * A subscription belonging to nobody here moves nobody. One Stripe account can serve more than one
	 * deployment — a colleague's {@code stripe listen} forwards to their machine and to yours — so an event
	 * that matches no tag and no customer is a state rather than a fault, and guessing would move a stranger's
	 * plan.
	 */
	@Test
	void anEventForNobodyWeBillChangesNothingAndIsStillAnsweredWith200() {
		Account buyer = whoJustSignedIn();
		Sub somebodyElses = subscriptionOf(buyer).forTheAccount(UUID.randomUUID()).asCustomer("cus_stranger");

		assertThat(this.stripe.delivered(started(somebodyElses)).statusCode()).isEqualTo(200);

		assertThat(planOf(buyer)).containsEntry("tier", "free").containsEntry("stripe_customer_id", null);
	}

	// --- repetition and order ---------------------------------------------------------------------------

	/**
	 * Stripe delivers at least once, so the same event arriving twice has to leave the same row — which it
	 * does because the mirror is a statement of the current state rather than a step.
	 */
	@Test
	void theSameEventTwiceIsTheSameRowOnce() {
		Account buyer = whoJustSignedIn();
		String delivered = started(subscriptionOf(buyer));

		this.stripe.delivered(delivered);
		this.stripe.delivered(delivered);

		assertThat(planOf(buyer)).containsEntry("tier", "pro").containsEntry("status", "active");
		assertThat(windowOf(buyer)).isEqualTo(List.of(utc(ANY_TIME), utc(ANY_TIME.plus(30, ChronoUnit.DAYS))));
	}

	/**
	 * And a redelivery of an old event does not undo a newer one. Stripe retries for three days, so a
	 * cancellation from Monday can arrive after Tuesday's resubscription — mirrored blindly, that would take
	 * away a plan somebody is currently paying for.
	 */
	@Test
	void andAnEventThatHasBeenOvertakenIsNotApplied() {
		Account buyer = whoJustSignedIn();
		String bought = started(subscriptionOf(buyer));
		this.stripe.delivered(bought);
		this.stripe.delivered(ended(subscriptionOf(buyer).as("canceled"), ANY_TIME.plusSeconds(60)));

		this.stripe.delivered(bought);

		assertThat(planOf(buyer)).containsEntry("tier", "free").containsEntry("status", "active");
	}

	/**
	 * While one stamped in the <em>same</em> second still applies. Stripe's timestamps are whole seconds and a
	 * Checkout generates the created and updated events for one subscription inside one of them, so refusing
	 * an equal timestamp would leave a paid-up subscriber on whatever the first of the pair said.
	 */
	@Test
	void andOneStampedInTheSameSecondAsTheLastStillDoes() {
		Account buyer = whoJustSignedIn();
		this.stripe.delivered(started(subscriptionOf(buyer).as("incomplete")));

		this.stripe.delivered(changed(subscriptionOf(buyer), ANY_TIME));

		assertThat(planOf(buyer)).containsEntry("status", "active");
	}

	// --- what cannot be acted on ------------------------------------------------------------------------

	/**
	 * Somebody is paying for a Price no tier in this catalog carries, so there is nothing to grant and they
	 * are left on the plan they were on. A Price created without a {@code metadata.tier_code} tag and then
	 * sold is the way here (ADR-0019), and it is an operator's mistake rather than a retryable failure — so
	 * the answer is 200 and a line in the log.
	 */
	@Test
	void aPriceNoTierCarriesGrantsNothing() {
		Account buyer = whoJustSignedIn();
		Sub bought = subscriptionOf(buyer);
		this.stripe.delivered(started(bought));

		assertThat(this.stripe.delivered(changed(bought.forThePrice("price_untagged"), ANY_TIME.plusSeconds(60)))
				.statusCode()).isEqualTo(200);

		// Left on what they had, which for a subscriber who never bought anything is the free tier: a Price
		// nothing sells is not a reason to move somebody, in either direction.
		assertThat(planOf(buyer)).containsEntry("tier", "pro").containsEntry("status", "active");
	}

	/**
	 * And their <strong>status</strong> is mirrored all the same, which is the half this used to drop.
	 *
	 * <p>The way an ordinary subscriber ends up on a Price no tier carries is a <em>reprice</em>: Stripe Prices
	 * are immutable, so a new amount is a new Price and the sync moves {@code tier.stripe_price_id} onto it,
	 * leaving everybody already paying matched to nothing. Refusing their whole event meant a card that started
	 * failing left the row saying {@code active} — so they went on relisting on a card Stripe was retrying, and
	 * the recovery would not have landed either. Their cancellation still worked, since {@code ended} never
	 * reads a price, which is what kept this quiet.
	 */
	@Test
	void andTheStatusOnItIsMirroredEvenThoughTheTierCannotMove() {
		Account buyer = whoJustSignedIn();
		Sub bought = subscriptionOf(buyer);
		this.stripe.delivered(started(bought));
		// The plan is repriced: a new Price tagged `pro`, which the sync moves the tier onto. This
		// subscription keeps the old one, which now belongs to no tier.
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro_v2");

		this.stripe.delivered(changed(bought.as("past_due"), ANY_TIME.plusSeconds(60)));

		assertThat(planOf(buyer)).containsEntry("tier", "pro").containsEntry("status", "past_due");
	}

	/** And the gate refuses them, which is the point of having mirrored it. */
	@Test
	void andTheGateThenRefusesThemLikeAnyOtherFailingCard() {
		Account buyer = whoJustSignedIn();
		Sub bought = subscriptionOf(buyer);
		this.stripe.delivered(started(bought));
		TierPrices.soldByTheMonth(this.db, "pro", "price_pro_v2");

		this.stripe.delivered(changed(bought.as("past_due"), ANY_TIME.plusSeconds(60)));

		HttpResponse<String> refused = new Relists(this.port)
				.authorizing(buyer.token(), "{\"adId\": \"an-ad-of-theirs\"}");

		assertThat(refused.statusCode()).isEqualTo(402);
		assertThat(Json.of(refused).get("reason").asString()).isEqualTo("SUBSCRIPTION_INACTIVE");
	}

	/**
	 * And a tier an operator has taken off sale still grants what its subscribers bought. Unpublishing stops
	 * new purchases; the people already on it keep renewing until they cancel, so the tier a Price names is
	 * looked up whether or not it is on the plan cards.
	 */
	@Test
	void aTierTakenOffSaleStillGrantsWhatItsSubscribersBought() {
		Account buyer = whoJustSignedIn();
		this.db.update("update tier set published = false where code = 'pro'");

		this.stripe.delivered(started(subscriptionOf(buyer)));

		assertThat(planOf(buyer)).containsEntry("tier", "pro").containsEntry("status", "active");
	}

	/**
	 * And a status this application has never heard of is not guessed at. Stripe adds statuses —
	 * {@code paused} is one nothing here asks for and could still be sent — and the column is held to seven by
	 * a check constraint, so the alternatives are inventing a status Stripe did not report or failing the
	 * write inside a webhook.
	 */
	@Test
	void aStatusStripeAddedLaterLeavesThePlanExactlyAsItWas() {
		Account buyer = whoJustSignedIn();
		Sub bought = subscriptionOf(buyer);
		this.stripe.delivered(started(bought));
		// Mid-dunning, so that a status read as `active` and one read as an end are both caught here rather
		// than passing because the row happened to say the right thing already.
		this.stripe.delivered(changed(bought.as("past_due"), ANY_TIME.plusSeconds(60)));

		assertThat(this.stripe.delivered(changed(bought.as("paused"), ANY_TIME.plusSeconds(120)))
				.statusCode()).isEqualTo(200);

		assertThat(planOf(buyer)).containsEntry("tier", "pro").containsEntry("status", "past_due");
	}

	/** And an event carrying no billing period at all grants nothing rather than a window made up here. */
	@Test
	void anEventWithNoBillingPeriodGrantsNothing() {
		Account buyer = whoJustSignedIn();

		this.stripe.delivered(event("customer.subscription.created", ANY_TIME,
				subscriptionWithNoPeriod(subscriptionOf(buyer))));

		assertThat(planOf(buyer)).containsEntry("tier", "free");
	}

	/**
	 * A period sent the way Stripe used to send it — on the subscription rather than on its items — is still a
	 * period. The field moved in the 2025 API versions and an account pinned to an older one still sends the
	 * old shape; the pinned {@code stripe-java} has no accessor for it at all, which is why the event is read
	 * as a tree.
	 */
	@Test
	void aPeriodSentTheOlderWayIsStillMirrored() {
		Account buyer = whoJustSignedIn();
		Sub bought = subscriptionOf(buyer);

		this.stripe.delivered(event("customer.subscription.created", ANY_TIME, subscriptionWithATopLevelPeriod(bought)));

		assertThat(planOf(buyer)).containsEntry("tier", "pro");
		assertThat(windowOf(buyer)).isEqualTo(List.of(utc(bought.periodStart()), utc(bought.periodEnd())));
	}

	// --- the signature, which is the whole of the authentication ----------------------------------------

	/**
	 * The one that matters here: a stranger who knows the shape of the event but not the secret cannot put
	 * themselves on a paid tier by posting one.
	 */
	@Test
	void anEventNobodySignedGrantsNobodyAnything() {
		Account buyer = whoJustSignedIn();

		HttpResponse<String> refused = this.stripe.deliveredUnsigned(started(subscriptionOf(buyer)));

		assertThat(refused.statusCode()).isEqualTo(400);
		assertThat(planOf(buyer)).containsEntry("tier", "free");
	}

	// --- and what the popup is then shown ---------------------------------------------------------------

	/**
	 * The whole thread, end to end: an account signs in and is free, Stripe says they subscribed, and the next
	 * thing the popup asks is answered with the tier they paid for and its quota. Every other test here reads
	 * the row; this one reads what a client reads, because the row is not the product.
	 */
	@Test
	void andWhatThePopupIsShownIsTheTierStripeSaidTheyBought() {
		Account buyer = whoJustSignedIn();
		assertThat(tierShownTo(buyer)).isEqualTo("free");

		this.stripe.delivered(started(subscriptionOf(buyer)));

		JsonNode shown = Json.of(displayStateOf(buyer.token()));
		assertThat(shown.get("tier").get("code").asString()).isEqualTo("pro");
		assertThat(shown.get("quotaRemaining").asInt()).isEqualTo(quotaOf("pro"));
		// In one offset before comparing, for {@link DisplayStateTest}'s reason: the two are the same instant
		// however the serializer chose to spell the zone.
		assertThat(OffsetDateTime.parse(shown.get("resetAt").asString()).withOffsetSameInstant(ZoneOffset.UTC))
				.isEqualTo(utc(subscriptionOf(buyer).periodEnd()));
	}

	/**
	 * An annual subscription is shown a month (T87, ADR-0037): the row keeps the year Stripe billed, and
	 * {@code resetAt} is the end of the month of it the buyer is in — the day their reposts come back, not the
	 * day Stripe renews.
	 */
	@Test
	void anAnnualSubscriptionIsShownTheMonthItIsInWhileTheRowKeepsTheYear() {
		Account buyer = whoJustSignedIn();
		OffsetDateTime bought = utc(ANY_TIME);
		Sub annual = subscriptionOf(buyer).forThePeriod(ANY_TIME, bought.plusYears(1).toInstant());

		this.stripe.delivered(started(annual));

		assertThat(windowOf(buyer)).isEqualTo(List.of(bought, bought.plusYears(1)));
		JsonNode shown = Json.of(displayStateOf(buyer.token()));
		assertThat(OffsetDateTime.parse(shown.get("resetAt").asString()).withOffsetSameInstant(ZoneOffset.UTC))
				.isEqualTo(bought.plusMonths(1));
		assertThat(shown.get("quotaRemaining").asInt()).isEqualTo(quotaOf("pro"));
	}

	// --- the events, as Stripe sends them ---------------------------------------------------------------

	/** {@code customer.subscription.created}: what a completed Checkout produces. */
	private static String started(Sub subscription) {
		return started(subscription, ANY_TIME);
	}

	private static String started(Sub subscription, Instant when) {
		return event("customer.subscription.created", when, objectOf(subscription));
	}

	/** {@code customer.subscription.updated}: a renewal, a card failing, a plan change. */
	private static String changed(Sub subscription, Instant when) {
		return event("customer.subscription.updated", when, objectOf(subscription));
	}

	/** {@code customer.subscription.deleted}: Stripe is finished with it. */
	private static String ended(Sub subscription, Instant when) {
		return event("customer.subscription.deleted", when, objectOf(subscription));
	}

	private static String event(String type, Instant created, Map<String, Object> object) {
		Map<String, Object> event = new LinkedHashMap<>();
		event.put("id", "evt_" + UUID.randomUUID());
		event.put("object", "event");
		event.put("type", type);
		event.put("created", created.getEpochSecond());
		event.put("data", Map.of("object", object));
		return JSON.writeValueAsString(event);
	}

	/** A subscription as the Stripe API versions of 2025 send one: the period is on each item. */
	private static Map<String, Object> objectOf(Sub subscription) {
		Map<String, Object> item = new LinkedHashMap<>();
		item.put("id", "si_1");
		item.put("object", "subscription_item");
		item.put("price", Map.of("id", subscription.price(), "object", "price"));
		item.put("current_period_start", subscription.periodStart().getEpochSecond());
		item.put("current_period_end", subscription.periodEnd().getEpochSecond());
		Map<String, Object> object = bareSubscription(subscription);
		object.put("items", Map.of("object", "list", "data", List.of(item)));
		return object;
	}

	/** And as they sent one before that: the period on the subscription itself. */
	private static Map<String, Object> subscriptionWithATopLevelPeriod(Sub subscription) {
		Map<String, Object> object = bareSubscription(subscription);
		object.put("current_period_start", subscription.periodStart().getEpochSecond());
		object.put("current_period_end", subscription.periodEnd().getEpochSecond());
		object.put("items", Map.of("object", "list", "data",
				List.of(Map.of("id", "si_1", "price", Map.of("id", subscription.price())))));
		return object;
	}

	/** A shape neither version sends, which is what a build that cannot read Stripe's would see. */
	private static Map<String, Object> subscriptionWithNoPeriod(Sub subscription) {
		Map<String, Object> object = bareSubscription(subscription);
		object.put("items", Map.of("object", "list", "data",
				List.of(Map.of("id", "si_1", "price", Map.of("id", subscription.price())))));
		return object;
	}

	private static Map<String, Object> bareSubscription(Sub subscription) {
		Map<String, Object> object = new LinkedHashMap<>();
		object.put("id", subscription.id());
		object.put("object", "subscription");
		object.put("customer", subscription.customer());
		object.put("status", subscription.status());
		object.put("metadata", subscription.account() == null ? Map.of()
				: Map.of("app_user_id", subscription.account().toString()));
		return object;
	}

	/**
	 * A subscription of Stripe's, as far as this application reads one. Written as one value with a name per
	 * departure from it, so that a test says what is different about its subscriber rather than restating six
	 * fields that are not.
	 */
	private record Sub(String id, String customer, UUID account, String status, String price, Instant periodStart,
			Instant periodEnd) {

		Sub as(String status) {
			return new Sub(this.id, this.customer, this.account, status, this.price, this.periodStart,
					this.periodEnd);
		}

		Sub called(String id) {
			return new Sub(id, this.customer, this.account, this.status, this.price, this.periodStart,
					this.periodEnd);
		}

		Sub asCustomer(String customer) {
			return new Sub(this.id, customer, this.account, this.status, this.price, this.periodStart,
					this.periodEnd);
		}

		Sub forTheAccount(UUID account) {
			return new Sub(this.id, this.customer, account, this.status, this.price, this.periodStart,
					this.periodEnd);
		}

		/** Stripe's own metadata gone, which is every subscription not created by our Checkout. */
		Sub untagged() {
			return forTheAccount(null);
		}

		Sub forThePrice(String price) {
			return new Sub(this.id, this.customer, this.account, this.status, price, this.periodStart,
					this.periodEnd);
		}

		Sub forThePeriod(Instant start, Instant end) {
			return new Sub(this.id, this.customer, this.account, this.status, this.price, start, end);
		}

	}

	// --- the accounts, and what they are shown ----------------------------------------------------------

	/**
	 * An account, created the way every account here is: by signing in. Provisioning is what the first request
	 * carrying an unseen subject does (#20), so this is also the assertion that the tag a Checkout writes is a
	 * real {@code app_user} id rather than one this suite invented.
	 */
	private Account whoJustSignedIn() {
		String subject = UUID.randomUUID().toString();
		String token = IDP.token(claims -> claims.subject(subject));
		assertThat(displayStateOf(token).statusCode()).isEqualTo(200);
		return new Account(this.db.queryForObject("select id from app_user where idp_subject = ?", UUID.class,
				subject), token);
	}

	/**
	 * The subscription that account bought, before anything has happened to it.
	 *
	 * <p>Its Stripe ids are derived from the account rather than fixed, because {@code stripe_customer_id} is
	 * unique in the schema: two subscribers sharing a literal here would be two rows claiming one customer,
	 * which is a collision of the suite's own making and not one Stripe can produce — it issues a customer per
	 * buyer, and {@code OpenCheckout} only ever passes back the one that account already had.
	 */
	private static Sub subscriptionOf(Account buyer) {
		return new Sub("sub_" + buyer.id(), "cus_" + buyer.id(), buyer.id(), "active", PRO_PRICE, ANY_TIME,
				ANY_TIME.plus(30, ChronoUnit.DAYS));
	}

	private HttpResponse<String> displayStateOf(String token) {
		return Http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + this.port + "/api/me"))
				.timeout(Duration.ofSeconds(20))
				.header("Authorization", "Bearer " + token)
				.GET()
				.build());
	}

	private String tierShownTo(Account account) {
		return Json.of(displayStateOf(account.token())).get("tier").get("code").asString();
	}

	// --- reading the row back ---------------------------------------------------------------------------

	/** The subscription row and the tier it points at, which is the plan somebody is on. */
	private Map<String, Object> planOf(Account account) {
		return this.db.queryForMap("""
				select tier.code as tier, subscription.status, subscription.created_at,
				       subscription.stripe_customer_id, subscription.stripe_subscription_id,
				       subscription.stripe_price_id
				  from subscription join tier on tier.id = subscription.tier_id
				 where subscription.app_user_id = ?
				""", account.id());
	}

	private List<OffsetDateTime> windowOf(Account account) {
		Map<String, Object> window = this.db.queryForMap(
				"select period_start, period_end from subscription where app_user_id = ?", account.id());
		return List.of(Subscribers.utc(window, "period_start"), Subscribers.utc(window, "period_end"));
	}

	private int quotaOf(String code) {
		return this.db.queryForObject("select relist_quota_per_period from tier where code = ?", Integer.class,
				code);
	}

	private static OffsetDateTime utc(Instant instant) {
		return instant.atOffset(ZoneOffset.UTC);
	}

	/** An account of this suite's, and the token it calls with. */
	private record Account(UUID id, String token) {
	}

	@Autowired
	private JdbcTemplate db;

	@LocalServerPort
	private int port;

	/** The deliveries this suite makes, signed with the secret above. */
	private StripeDeliveries stripe;

	/**
	 * When every event in this suite says it happened, unless a test moves it. Whole seconds, because that is
	 * Stripe's granularity and the mirror orders events by it — a fractional one here would be a suite testing
	 * a precision the wire does not carry.
	 */
	private static final Instant ANY_TIME = Instant.now().truncatedTo(ChronoUnit.SECONDS);

	/** The Price the seeded `pro` is sold at here, as T51's webhook would have written it. */
	private static final String PRO_PRICE = "price_pro_monthly";

	private static final JsonMapper JSON = JsonMapper.builder().build();

}
