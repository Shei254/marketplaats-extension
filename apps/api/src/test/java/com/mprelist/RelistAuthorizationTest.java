package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.awaitility.Awaitility.await;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import javax.sql.DataSource;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
 * {@code POST /api/relist/authorize}: who may relist, what it costs them, and what a refusal says (#22,
 * ADR-0007, {@code docs/enforcement-contract.md}).
 *
 * <p>The first route this application ships, so unlike #19's and #20's suites this one brings no fixture of its
 * own — every call below is the call the extension will make. Over a real port for {@link ResourceServerTest}'s
 * reason: the first check in the contract's order is the token, and it is enforced by a filter chain MockMvc
 * installs only when {@code spring-security-test} happens to be on the classpath.
 *
 * <p>State is arranged as data, which is the seam {@code docs/specs/quota-enforcement.md} asks for: a tier with
 * a chosen quota, a subscription with a chosen status and window, and reservations already held against it.
 * Those rows are what the gate reads, and arranging them is the only way to reach a state — a lapsed payer, a
 * window that closed three months ago — that no sequence of calls to this API can produce.
 *
 * <p>Not {@code @Transactional}: the application answers on its own connection, so a rollback here would
 * neither see nor undo what it wrote. Each test empties {@code app_user} instead, which takes the subscriptions
 * and reservations with it, and drops the tiers this suite arranged.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(PostgresFromCompose.class)
class RelistAuthorizationTest {

	/** In a field initialiser for {@link DynamicPropertySource}'s sake — see {@link ResourceServerTest}. */
	private static final MintedTokens IDP = MintedTokens.servingItsKeys();

	@DynamicPropertySource
	static void trustTheTokensThisSuiteMints(DynamicPropertyRegistry properties) {
		properties.add("spring.security.oauth2.resourceserver.jwt.issuer-uri", IDP::issuerUri);
	}

	@AfterAll
	static void stopServingKeys() {
		IDP.close();
	}

	/** Accounts first, which takes their subscriptions and reservations with it, then this suite's own tiers. */
	@BeforeEach
	void nobodyHasRelistedYet() {
		this.db.update("delete from app_user");
		this.db.update("delete from tier where code like '" + TIERS_OF_THIS_SUITE + "%'");
	}

	/** One instance per test, so the two callers below belong to the test that fired them. */
	@AfterEach
	void stopCalling() {
		this.callers.shutdownNow();
	}

	@Test
	void anActiveSubscriberWithQuotaLeftIsAuthorizedToRelist() {
		Subscriber user = aSubscriberEntitledTo(3);

		HttpResponse<String> authorized = authorize(user, "ad-1");

		assertThat(authorized.statusCode()).isEqualTo(200);
		assertThat(json(authorized).get("jti").asString()).isEqualTo(theOnlyReservationOf(user).toString());
		assertThat(json(authorized).get("authToken").asString()).isNotBlank();
	}

	/**
	 * And the authorization is the signed one ADR-0007 requires rather than a claim the client could make for
	 * itself: the four claims the contract names, over a signature.
	 *
	 * <p>{@code sub} is our own {@code app_user} id and not the IdP subject the caller's token carries — we are
	 * the only reader this token will ever have, and every row in the schema is keyed by our id. The
	 * {@code jti} is the reservation, which is what makes the grant single-use without a table to burn it in:
	 * #23 settles the reservation it names, and {@code relist_event.reservation_id} is unique.
	 *
	 * <p>What is <em>not</em> asserted is that the signature verifies, because nothing in this application
	 * verifies one yet — {@code /complete} takes a {@code jti} and resolves a row. The day something does is the
	 * day the key stops being generated per process, and the test that a forged token is refused belongs to it.
	 */
	@Test
	void andTheAuthorizationNamesTheCallerTheAdAndTheReservationItSpent() {
		Subscriber user = aSubscriberEntitledTo(3);

		HttpResponse<String> authorized = authorize(user, "ad-42");

		JsonNode granted = json(authorized);
		JsonNode claims = KeycloakFromCompose.claimsOf(granted.get("authToken").asString());
		assertThat(claims.get("sub").asString()).isEqualTo(user.account().toString());
		assertThat(claims.get("adId").asString()).isEqualTo("ad-42");
		assertThat(claims.get("jti").asString()).isEqualTo(granted.get("jti").asString());
		assertThat(Instant.ofEpochSecond(claims.get("exp").asLong()))
				.isEqualTo(expiryOf(granted).truncatedTo(ChronoUnit.SECONDS).toInstant());
		assertThat(headerOf(granted.get("authToken").asString()).get("alg").asString()).isEqualTo("RS256");
		assertThat(granted.get("authToken").asString().split("\\.")[2]).isNotEmpty();
	}

	/**
	 * About 45 seconds out, which is what makes a stockpile worthless: every authorization fetched ahead of time
	 * costs a unit of quota and is dead before it can be spent. Sent as an ISO-8601 string beside the token, so
	 * that a client can tell whether the grant it holds is still good without decoding a JWT.
	 *
	 * <p>The reservation carries the same instant, since #24 finds abandoned reservations by the expiry of the
	 * authorization issued against them rather than by a second rule that could drift from this one.
	 */
	@Test
	void andExpiresSoonEnoughThatOneCannotBeSavedForLater() {
		OffsetDateTime beforeTheCall = now();

		Subscriber user = aSubscriberEntitledTo(3);
		JsonNode granted = json(authorize(user, "ad-1"));

		assertThat(granted.get("expiresAt").isString()).isTrue();
		assertThat(expiryOf(granted)).isBetween(beforeTheCall.plusSeconds(40), now().plusSeconds(45));
		// Within a millisecond rather than to the nanosecond: Postgres keeps microseconds and the JVM clock
		// may offer more, so an exact comparison would be asserting how the driver rounds.
		assertThat(reservationsOf(user)).singleElement().satisfies(held -> assertThat(utc(held, "expires_at"))
				.isCloseTo(expiryOf(granted), within(1, ChronoUnit.MILLIS)));
	}

	/**
	 * One unit is held from this moment, before the extension has done anything with the grant. That is the
	 * point of a reservation rather than a record written afterwards: the relist is about to become a delete on
	 * Marktplaats, and a unit that was only counted on the way back would leave an in-flight relist costing
	 * nothing and a crashed one costing nothing either.
	 */
	@Test
	void andOneUnitIsHeldAgainstThePeriodFromThatMomentOn() {
		Subscriber user = aSubscriberEntitledTo(3);

		authorize(user, "ad-1");

		assertThat(reservationsOf(user)).singleElement().satisfies(held -> {
			assertThat(held.get("status")).isEqualTo("RESERVED");
			assertThat(held.get("ad_id")).isEqualTo("ad-1");
			assertThat(utc(held, "reserved_at")).isBetween(windowOf(user).start(), windowOf(user).end());
		});
	}

	/**
	 * Quota is spent one relist at a time until there is none, and the call that finds none left is refused with
	 * the date it comes back — "you have used your 3" being actionable only beside "and they return on the
	 * 14th". The refusal costs nothing: a denied caller has spent no unit, or a user out of quota would sink
	 * deeper into it by asking.
	 */
	@Test
	void aSubscriberWhoHasSpentThePeriodsQuotaIsRefusedWithTheDateItComesBack() {
		Subscriber user = aSubscriberEntitledTo(2);
		assertThat(authorize(user, "ad-1").statusCode()).isEqualTo(200);
		assertThat(authorize(user, "ad-2").statusCode()).isEqualTo(200);

		HttpResponse<String> refused = authorize(user, "ad-3");

		assertThat(refused.statusCode()).isEqualTo(429);
		assertThat(json(refused).get("reason").asString()).isEqualTo("QUOTA_EXCEEDED");
		assertThat(OffsetDateTime.parse(json(refused).get("resetAt").asString())).isEqualTo(windowOf(user).end());
		assertThat(reservationsOf(user)).hasSize(2);
		// The shape the contract fixes for every denial, pinned here because this one is written by a message
		// converter rather than by the entry point #19 wrote by hand — two paths to one promise.
		assertThat(refused.headers().firstValue("Content-Type"))
				.hasValueSatisfying(type -> assertThat(type).isEqualTo("application/json"));
	}

	/**
	 * And a tier granting nothing denies every relist through that same path rather than through a case of its
	 * own. Zero is a coherent grant — a paused plan, or a rung an operator has set to nothing — and it should
	 * read to the user as an exhausted quota, which is one code path rather than two.
	 */
	@Test
	void andATierGrantingNothingRefusesLikeAnyOtherExhaustedQuota() {
		Subscriber user = aSubscriberEntitledTo(0);

		HttpResponse<String> refused = authorize(user, "ad-1");

		assertThat(refused.statusCode()).isEqualTo(429);
		assertThat(json(refused).get("reason").asString()).isEqualTo("QUOTA_EXCEEDED");
		assertThat(reservationsOf(user)).isEmpty();
	}

	/**
	 * A refunded reservation is not one the user still holds. {@code FAILED_BEFORE_DELETE} means nothing
	 * happened on Marktplaats (#23), so the unit returns to the period — and a count that asked for
	 * {@code RESERVED} rows instead of "not refunded" would give every settled relist back the same way.
	 */
	@Test
	void aRefundedReservationIsNotOneTheyAreStillHolding() {
		Subscriber user = aSubscriberEntitledTo(1);
		refunded(unitHeldBy(user, now().minusHours(1)));

		assertThat(authorize(user, "ad-1").statusCode()).isEqualTo(200);
	}

	/** And a settled one is: the relist happened, and the unit stays spent for the rest of the period. */
	@Test
	void butASettledOneIs() {
		Subscriber user = aSubscriberEntitledTo(1);
		settled(unitHeldBy(user, now().minusHours(1)));

		assertThat(authorize(user, "ad-1").statusCode()).isEqualTo(429);
	}

	/**
	 * Usage is counted in this period and not in the user's whole history, which is the difference between a
	 * quota and a lifetime allowance.
	 */
	@Test
	void andAUnitSpentBeforeThisPeriodBeganIsNotCountedInIt() {
		Subscriber user = aSubscriberEntitledTo(1);
		unitHeldBy(user, windowOf(user).start().minusSeconds(1));

		assertThat(authorize(user, "ad-1").statusCode()).isEqualTo(200);
	}

	/** And quota is per user: somebody else's relists are not this caller's to be refused for. */
	@Test
	void andNorIsSomebodyElsesRelist() {
		Subscriber user = aSubscriberEntitledTo(1);
		unitHeldBy(aSubscriberEntitledTo(1), now());

		assertThat(authorize(user, "ad-1").statusCode()).isEqualTo(200);
	}

	/**
	 * A lapsed payer is told their subscription stopped, not that they are out of quota — and this is the test
	 * of the order, since they are out of quota too. The other way round they would be shown an upgrade prompt
	 * for a plan they are no longer paying for, and the one thing they can act on would be the thing they were
	 * not told.
	 *
	 * <p>{@code 402} carries no {@code resetAt}, because there is no window in which this caller's problem
	 * resolves itself. A field that arrived as {@code null} would invite the extension to render a reset date it
	 * does not have.
	 */
	@Test
	void aLapsedPayerIsToldTheirSubscriptionStoppedRatherThanThatTheyAreOutOfQuota() {
		Subscriber user = aSubscriberEntitledTo(0);
		itsStatusIs(user, "past_due");

		HttpResponse<String> refused = authorize(user, "ad-1");

		assertThat(refused.statusCode()).isEqualTo(402);
		assertThat(json(refused).get("reason").asString()).isEqualTo("SUBSCRIPTION_INACTIVE");
		assertThat(json(refused).has("resetAt")).isFalse();
		assertThat(reservationsOf(user)).isEmpty();
	}

	/**
	 * Every status Stripe has for a subscription that is not paying is the same refusal. Listed one by one
	 * rather than asserted as "not active", because the set is the contract's — a status added to the check
	 * constraint without a decision here would otherwise be allowed by default, which is the wrong way round for
	 * a gate that fails closed.
	 */
	@ParameterizedTest
	@ValueSource(strings = { "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired" })
	void andSoIsEveryOtherStatusStripeCallsInactive(String status) {
		Subscriber user = aSubscriberEntitledTo(3);
		itsStatusIs(user, status);

		HttpResponse<String> refused = authorize(user, "ad-1");

		assertThat(refused.statusCode()).isEqualTo(402);
		assertThat(json(refused).get("reason").asString()).isEqualTo("SUBSCRIPTION_INACTIVE");
	}

	/**
	 * A trial is a subscription that entitles, with no special case anywhere: ADR-0006 puts trial days on the
	 * Stripe Price, so {@code trialing} arrives through the same webhook mirror as {@code active} and is allowed
	 * beside it. The day it lapses Stripe says so with one of the five above.
	 */
	@Test
	void butATrialIsASubscriptionThatEntitlesItsHolder() {
		Subscriber user = aSubscriberEntitledTo(3);
		itsStatusIs(user, "trialing");

		assertThat(authorize(user, "ad-1").statusCode()).isEqualTo(200);
	}

	/**
	 * A caller this API has never seen is authorized on the account the call itself provisions. The route asks
	 * for a {@link com.mprelist.identity.UserRef}, so first login happens on the way in (#20) — which matters
	 * here because #35 wires the gate into the extension's orchestrator, and the first thing a user does after
	 * signing in may well be to relist.
	 */
	@Test
	void aCallerThisApiHasNeverSeenIsAuthorizedOnTheAccountTheCallProvisions() {
		String signingInForTheFirstTime = UUID.randomUUID().toString();

		HttpResponse<String> authorized = authorize(IDP.token(claims -> claims.subject(signingInForTheFirstTime)),
				"""
						{"adId": "ad-1"}""");

		assertThat(authorized.statusCode()).isEqualTo(200);
		assertThat(this.db.queryForObject("""
				select count(*) from usage_reservation reservation
				join subscription on subscription.app_user_id = reservation.app_user_id
				join app_user account on account.id = reservation.app_user_id
				where account.idp_subject = ? and subscription.tier_id = (select id from tier where is_default)
				""", Integer.class, signingInForTheFirstTime)).isEqualTo(1);
	}

	/** A call carrying no token reserves nothing, because it reaches no handler at all (#19). */
	@Test
	void aCallWithNoTokenReservesNothingAndIsToldToSignIn() {
		HttpResponse<String> refused = authorize((String) null, """
				{"adId": "ad-1"}""");

		assertThat(refused.statusCode()).isEqualTo(401);
		assertThat(json(refused).get("reason").asString()).isEqualTo("UNAUTHENTICATED");
		assertThat(everyReservation()).isEmpty();
	}

	/**
	 * A body naming no ad is a request this API could not read rather than a caller it turned away, so it comes
	 * back as a {@code 400} carrying <strong>no reason code</strong> — which is the shape
	 * {@code docs/enforcement-contract.md} reserves for a {@code 4xx} that is not a denial, and the reason the
	 * extension's gate can read the presence of {@code reason} as meaning it was refused.
	 */
	@Test
	void aBodyNamingNoAdIsARequestThisApiCouldNotReadRatherThanADenial() {
		Subscriber user = aSubscriberEntitledTo(3);

		HttpResponse<String> unread = authorize(user.token(), "{}");

		assertThat(unread.statusCode()).isEqualTo(400);
		assertThat(unread.body()).doesNotContain("reason");
		assertThat(reservationsOf(user)).isEmpty();
	}

	/**
	 * And a body still carrying the field the contract removed is authorized anyway. ADR-0007's 2026-08-13
	 * refinement dropped {@code marktplaatsAccountId}, and an extension release takes days where an API deploy
	 * takes minutes (#52) — so the build that is still sending it has to keep working rather than be refused for
	 * a field this API no longer reads.
	 */
	@Test
	void butOneStillCarryingTheFieldTheContractRemovedIsNotRefusedForIt() {
		Subscriber user = aSubscriberEntitledTo(3);

		HttpResponse<String> authorized = authorize(user.token(), """
				{"adId": "ad-1", "marktplaatsAccountId": "whatever-it-used-to-send"}""");

		assertThat(authorized.statusCode()).isEqualTo(200);
	}

	/**
	 * A free window that has closed is rolled forward before anything is counted in it — the half of ADR-0014's
	 * monthly roll that #20 deferred to here, since this is the first code that reads
	 * {@code [periodStart, periodEnd)} and so the first that can notice the window has closed.
	 *
	 * <p>What it prevents is the shape of bug that would have been discovered by users: from a free account's
	 * second month, every relist would be counted against a window that ended long ago, so the three units spent
	 * in the first month would still be held and the account would be permanently exhausted.
	 */
	@Test
	void aFreeWindowThatHasClosedIsRolledForwardBeforeUsageIsCountedInIt() {
		Subscriber user = aSubscriberEntitledTo(1);
		OffsetDateTime signedUpFiveMonthsAgo = now().minusMonths(5);
		provisionedAt(user, signedUpFiveMonthsAgo);
		unitHeldBy(user, signedUpFiveMonthsAgo.plusDays(3));

		HttpResponse<String> authorized = authorize(user, "ad-1");

		assertThat(authorized.statusCode()).isEqualTo(200);
		Window rolled = windowOf(user);
		assertThat(rolled.start()).isBeforeOrEqualTo(now());
		assertThat(rolled.end()).isAfter(now()).isEqualTo(rolled.start().plusMonths(1));
	}

	/**
	 * And the window it rolls into starts on the day the account was provisioned, which is what keeps a reset
	 * date somebody plans around from walking.
	 *
	 * <p>The anchor is the subscription's own creation and not the window being replaced. Rolling from the
	 * stored start re-anchors on whatever the last roll clamped to — an account provisioned on the 31st spends
	 * February on the 28th and every month after that on the 28th — so the arrangement here is a window that has
	 * already drifted off the anchor, and the assertion is that the roll puts it back rather than compounding
	 * it. Asserted as "a whole number of months after provisioning" rather than as a date, so that it says the
	 * same thing whichever month this suite is run in.
	 */
	@Test
	void andTheWindowItRollsIntoStartsOnTheDayTheAccountWasProvisioned() {
		Subscriber user = aSubscriberEntitledTo(1);
		OffsetDateTime signedUpOnAThirtyFirst = OffsetDateTime.of(2024, 1, 31, 9, 15, 0, 0, ZoneOffset.UTC);
		provisionedAt(user, signedUpOnAThirtyFirst);
		itsWindowIs(user, signedUpOnAThirtyFirst.plusMonths(1), signedUpOnAThirtyFirst.plusMonths(2));

		authorize(user, "ad-1");

		OffsetDateTime rolled = windowOf(user).start();
		assertThat(signedUpOnAThirtyFirst.plusMonths(ChronoUnit.MONTHS.between(signedUpOnAThirtyFirst, rolled)))
				.isEqualTo(rolled);
	}

	/**
	 * And {@code resetAt} is answerable again, which is the promise the missing roll actually broke: the
	 * contract says every quota denial carries the date the quota returns, and a free account past its first
	 * month would have been handed one in the past — a cooldown the popup would render as already over.
	 */
	@Test
	void andSoTheDateAQuotaComesBackIsNeverOneThatHasPassed() {
		Subscriber user = aSubscriberEntitledTo(0);
		provisionedAt(user, now().minusMonths(3));

		HttpResponse<String> refused = authorize(user, "ad-1");

		assertThat(refused.statusCode()).isEqualTo(429);
		assertThat(OffsetDateTime.parse(json(refused).get("resetAt").asString())).isAfter(now());
	}

	/**
	 * But a window Stripe owns is left alone, because it is not ours to move. A payer's period is copied from
	 * Stripe's own (#30), so one that has closed means a webhook has not arrived yet — and rolling it here would
	 * invent a period Stripe did not grant: a month's quota to an annual plan every month, and a fresh one to a
	 * subscriber whose next webhook says {@code past_due}.
	 *
	 * <p>Nothing is purchasable until #28 and #29, so no row carries a Stripe subscription today. The branch is
	 * asserted rather than left to be discovered by the first person who pays.
	 */
	@Test
	void butAWindowStripeOwnsIsLeftForItsWebhookToMove() {
		Subscriber user = aSubscriberEntitledTo(3);
		provisionedAt(user, now().minusMonths(3));
		itIsMirroredFromStripe(user);
		Window closed = windowOf(user);

		assertThat(authorize(user, "ad-1").statusCode()).isEqualTo(200);
		assertThat(windowOf(user)).isEqualTo(closed);
	}

	/**
	 * The subscription row is held for the length of the call that is spending against it, which is what makes
	 * reading a quota and then reserving against it one decision rather than two.
	 *
	 * <p>Asserted as the mechanism, not only as the outcome: the row is locked on a connection of this suite's
	 * own, and the call is then observed to be waiting on it — Postgres reporting a backend blocked on a lock —
	 * rather than answering from a count that could already be stale. A gate that read the row without the lock
	 * would answer immediately, which is what this fails on.
	 */
	@Test
	void theSubscriptionIsHeldForTheLengthOfTheCallSpendingAgainstIt() throws Exception {
		Subscriber user = aSubscriberEntitledTo(1);
		try (Connection somebodyElse = this.database.getConnection()) {
			somebodyElse.setAutoCommit(false);
			lockTheSubscriptionOf(somebodyElse, user);

			Future<HttpResponse<String>> inFlight = fire(user, "ad-1");
			waitUntilBlockedOnALock(1);

			assertThat(inFlight.isDone()).isFalse();
			somebodyElse.rollback();
			assertThat(inFlight.get(30, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
		}
	}

	/**
	 * And so two callers holding one unit between them do not both spend it. Two of the same person's clicks —
	 * the popup and an injected button, or one impatient double-click — arrive together, and without something
	 * to serialise them both count nothing spent and both are authorized.
	 *
	 * <p>Arranged rather than raced, the way #20's concurrency test is: both calls are queued behind a lock this
	 * suite holds, so they contend the moment it is released instead of when the scheduler happens to overlap
	 * them.
	 */
	@Test
	void andTwoCallersHoldingOneUnitBetweenThemDoNotBothSpendIt() throws Exception {
		Subscriber user = aSubscriberEntitledTo(1);
		try (Connection somebodyElse = this.database.getConnection()) {
			somebodyElse.setAutoCommit(false);
			lockTheSubscriptionOf(somebodyElse, user);

			Future<HttpResponse<String>> first = fire(user, "ad-1");
			Future<HttpResponse<String>> second = fire(user, "ad-2");
			waitUntilBlockedOnALock(2);
			somebodyElse.rollback();

			assertThat(List.of(first.get(30, TimeUnit.SECONDS).statusCode(),
					second.get(30, TimeUnit.SECONDS).statusCode())).containsExactlyInAnyOrder(200, 429);
			assertThat(reservationsOf(user)).hasSize(1);
		}
	}

	// --- the call itself --------------------------------------------------------------------------------

	private HttpResponse<String> authorize(Subscriber user, String adId) {
		return authorize(user.token(), "{\"adId\": \"" + adId + "\"}");
	}

	private HttpResponse<String> authorize(String token, String body) {
		HttpRequest.Builder request = HttpRequest
				.newBuilder(URI.create("http://localhost:" + this.port + "/api/relist/authorize"))
				.timeout(Duration.ofSeconds(20))
				.header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
		return Http.send((token == null ? request : request.header("Authorization", "Bearer " + token)).build());
	}

	/** The same call on a thread of its own, for the two tests that need one in flight while they arrange. */
	private Future<HttpResponse<String>> fire(Subscriber user, String adId) {
		return this.callers.submit(() -> authorize(user, adId));
	}

	// --- arrangement ------------------------------------------------------------------------------------

	/**
	 * An account on a tier of this suite's own, {@code active}, with a window that is open now — the ordinary
	 * state of a subscriber, arranged directly because most of what is interesting here is a departure from it.
	 *
	 * <p>The tier is arranged rather than taken from the seeded catalog, for {@link TierEntitlementTest}'s
	 * reason: those numbers are an operator's to edit (ADR-0014), so a suite that spent the free rung's three
	 * would start failing the day somebody tuned it.
	 */
	private Subscriber aSubscriberEntitledTo(int relistsPerPeriod) {
		UUID tier = this.db.queryForObject("""
				insert into tier (code, name, relist_quota_per_period, max_marktplaats_accounts)
				values (?, 'A tier of this suite''s own', ?, 1) returning id
				""", UUID.class, TIERS_OF_THIS_SUITE + UUID.randomUUID(), relistsPerPeriod);
		String idpSubject = UUID.randomUUID().toString();
		UUID account = this.db.queryForObject("insert into app_user (idp_subject) values (?) returning id",
				UUID.class, idpSubject);
		OffsetDateTime provisioned = now().minusDays(1);
		this.db.update("""
				insert into subscription (app_user_id, tier_id, status, period_start, period_end)
				values (?, ?, 'active', ?, ?)
				""", account, tier, provisioned, provisioned.plusMonths(1));
		return new Subscriber(idpSubject, account);
	}

	private void itsStatusIs(Subscriber user, String status) {
		this.db.update("update subscription set status = ? where app_user_id = ?", status, user.account());
	}

	private void itsWindowIs(Subscriber user, OffsetDateTime start, OffsetDateTime end) {
		this.db.update("update subscription set period_start = ?, period_end = ? where app_user_id = ?", start, end,
				user.account());
	}

	/** Signed up then, and never seen since: the created_at the roll anchors on, and the window #20 wrote. */
	private void provisionedAt(Subscriber user, OffsetDateTime when) {
		this.db.update("update subscription set created_at = ? where app_user_id = ?", when, user.account());
		itsWindowIs(user, when, when.plusMonths(1));
	}

	/** A subscription with a Stripe counterpart, whose window is Stripe's to move rather than ours. */
	private void itIsMirroredFromStripe(Subscriber user) {
		this.db.update("update subscription set stripe_subscription_id = ? where app_user_id = ?",
				"sub_" + UUID.randomUUID(), user.account());
	}

	private UUID unitHeldBy(Subscriber user, OffsetDateTime when) {
		return this.db.queryForObject("""
				insert into usage_reservation (app_user_id, ad_id, reserved_at, expires_at)
				values (?, 'an-earlier-ad', ?, ?) returning id
				""", UUID.class, user.account(), when, when.plusSeconds(45));
	}

	private void refunded(UUID reservation) {
		resolved(reservation, "REFUNDED");
	}

	private void settled(UUID reservation) {
		resolved(reservation, "SETTLED");
	}

	private void resolved(UUID reservation, String status) {
		this.db.update("update usage_reservation set status = ?, resolved_at = now() where id = ?", status,
				reservation);
	}

	private void lockTheSubscriptionOf(Connection connection, Subscriber user) throws SQLException {
		try (PreparedStatement lock = connection
				.prepareStatement("select id from subscription where app_user_id = ? for update")) {
			lock.setObject(1, user.account());
			lock.executeQuery().close();
		}
	}

	/**
	 * Waits until Postgres reports that many backends blocked on a lock, which is the application's own read of
	 * the subscription row stopped on the row this suite is holding. Asking the database rather than sleeping is
	 * what makes the two tests above an arrangement rather than a race with a longer fuse.
	 */
	private void waitUntilBlockedOnALock(int callers) {
		await().atMost(Duration.ofSeconds(15)).until(() -> this.db.queryForObject(
				"select count(*) from pg_stat_activity where wait_event_type = 'Lock'", Integer.class) >= callers);
	}

	// --- reading back -----------------------------------------------------------------------------------

	private List<Map<String, Object>> reservationsOf(Subscriber user) {
		return this.db.queryForList(
				"select id, ad_id, status, reserved_at, expires_at from usage_reservation where app_user_id = ?",
				user.account());
	}

	private UUID theOnlyReservationOf(Subscriber user) {
		assertThat(reservationsOf(user)).hasSize(1);
		return (UUID) reservationsOf(user).get(0).get("id");
	}

	private List<Map<String, Object>> everyReservation() {
		return this.db.queryForList("select id from usage_reservation");
	}

	private Window windowOf(Subscriber user) {
		Map<String, Object> period = this.db.queryForMap(
				"select period_start, period_end from subscription where app_user_id = ?", user.account());
		return new Window(utc(period, "period_start"), utc(period, "period_end"));
	}

	/**
	 * A {@code timestamptz} out of a row read as a map, in UTC — which is the offset it was written in, and the
	 * one every comparison here is about. {@link JdbcTemplate} hands these back as {@link Timestamp} rather than
	 * as the {@code java.time} value the column holds, and a {@code Timestamp} carries an instant with no offset
	 * of its own.
	 */
	private static OffsetDateTime utc(Map<String, Object> row, String column) {
		return ((Timestamp) row.get(column)).toInstant().atOffset(ZoneOffset.UTC);
	}

	private static OffsetDateTime expiryOf(JsonNode granted) {
		return OffsetDateTime.parse(granted.get("expiresAt").asString()).withOffsetSameInstant(ZoneOffset.UTC);
	}

	private static JsonNode json(HttpResponse<String> response) {
		return JSON.readTree(response.body());
	}

	/** The half of a JWT {@link KeycloakFromCompose#claimsOf} does not read: what it was signed with. */
	private static JsonNode headerOf(String jwt) {
		return JSON.readTree(Base64.getUrlDecoder().decode(jwt.split("\\.")[0]));
	}

	private static OffsetDateTime now() {
		return OffsetDateTime.now(ZoneOffset.UTC);
	}

	private record Subscriber(String idpSubject, UUID account) {

		String token() {
			return IDP.token(claims -> claims.subject(this.idpSubject));
		}

	}

	private record Window(OffsetDateTime start, OffsetDateTime end) {
	}

	@Autowired
	private JdbcTemplate db;

	/** For the two tests that hold a row of their own across a call the application makes. */
	@Autowired
	private DataSource database;

	@LocalServerPort
	private int port;

	private final ExecutorService callers = Executors.newFixedThreadPool(2);

	/** The prefix that tells this suite's tiers from the seeded catalog, which it must leave as it found it. */
	private static final String TIERS_OF_THIS_SUITE = "authorize-suite-";

	private static final JsonMapper JSON = JsonMapper.builder().build();

}
