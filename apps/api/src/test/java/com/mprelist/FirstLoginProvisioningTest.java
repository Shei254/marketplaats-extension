package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import javax.sql.DataSource;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.mprelist.identity.UserRef;


/**
 * First login: the first request carrying a subject this API has never seen leaves behind an
 * {@code app_user} and, with it, a {@code subscription} on the default tier (#20, ADR-0014).
 *
 * <p>There is no login endpoint to test — the API is a resource server, and ADR-0014's "on first login"
 * therefore means "on the first request we can attribute to somebody new". So this drives it the way it will
 * really happen: a token over a real port, at a route that declares a {@link UserRef} parameter, with the
 * rows read back from the Postgres Flyway just migrated. The route is a fixture of this suite's own, and
 * stays one now that #26 ships a real declarer of a {@link UserRef}: what is asserted here is the row the
 * resolver left behind, which means answering with the {@code UserRef} itself — and {@code /api/me}
 * deliberately does not, because its body is display state and our own account id is no part of it.
 * {@link DisplayStateTest} asserts the other half from outside: a subject this API has never seen is answered
 * with the plan it has just been provisioned onto.
 *
 * <p>Not {@code @Transactional}. The application answers on its own connection, so a rollback here would
 * neither see nor undo what it wrote; each test empties {@code app_user} instead, and the cascade takes the
 * subscriptions with it. The tier catalog is left as {@code V2__seed_tier_catalog.sql} left it, because which
 * tier carries {@code is_default} is the seed's promise and {@link TierCatalogSeedTest} is where it is held.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import({ PostgresFromCompose.class, FirstLoginProvisioningTest.ProbeRoute.class })
class FirstLoginProvisioningTest {

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
	void nobodyHasSignedInYet() {
		this.db.update("delete from app_user");
	}

	@Test
	void aSubjectThisApiHasNeverSeenBeforeGetsAnAccount() {
		String subject = somebodyNew();

		HttpResponse<String> answered = get(ACCOUNT, IDP.token(claims -> claims.subject(subject)));

		assertThat(answered.statusCode()).isEqualTo(200);
		assertThat(accountsFor(subject)).containsExactly(userRefIn(answered));
	}

	/**
	 * And the subscription that arrives with it, which is the whole of ADR-0014's "no subscription is
	 * unreachable": the free tier is an ordinary row, so a new account is {@code active} on it rather than
	 * being a user without a plan that every reader would then have to branch on.
	 */
	@Test
	void andASubscriptionOnTheDefaultTierRatherThanNoneAtAll() {
		signIn(somebodyNew());

		Map<String, Object> subscription = theOnlySubscription();

		assertThat(subscription.get("status")).isEqualTo("active");
		assertThat(subscription.get("tier_id")).isEqualTo(theDefaultTier());
	}

	/**
	 * Free users have no Stripe period to copy, so theirs is rolled from the moment they were provisioned —
	 * which is what makes {@code resetAt} answerable for every user rather than only for payers (#26).
	 *
	 * <p>A calendar month, asserted as one. Thirty days would pass a test written as "about a month" while
	 * walking the reset date a day earlier every month, and the reset date is a thing a user plans around.
	 */
	@Test
	void andAPeriodThatRunsAMonthFromTheMomentItWasProvisioned() {
		OffsetDateTime beforeTheCall = OffsetDateTime.now(ZoneOffset.UTC);

		signIn(somebodyNew());

		OffsetDateTime start = storedInstant("period_start");
		assertThat(start).isBetween(beforeTheCall, OffsetDateTime.now(ZoneOffset.UTC));
		assertThat(storedInstant("period_end")).isEqualTo(start.plusMonths(1));
	}

	/**
	 * And the anchor the roll will count months from is that same instant.
	 *
	 * <p>{@code created_at} is written here rather than left to the column's {@code default now()}, which is
	 * the database's clock where this window is the application's. It matters because
	 * {@code SubscriptionRows.rolledForward} counts whole months from the anchor rather than from the window
	 * it replaces: were the two written by clocks a few seconds apart, every {@code resetAt} a free user ever
	 * saw would sit that far off the period it belongs to, in a direction nobody chose and nothing reports.
	 */
	@Test
	void andAnAnchorTheMonthlyRollCountsFromThatIsThatSameInstantAgain() {
		signIn(somebodyNew());

		assertThat(storedInstant("created_at")).isEqualTo(storedInstant("period_start"));
	}

	/**
	 * A returning caller is the same account, not a second one. The unique on {@code idp_subject} is what
	 * makes a second row impossible; this is what says the code does not try, since an insert that collided
	 * every time would surface as an error rather than as a duplicate.
	 */
	@Test
	void andComingBackIsTheSameAccountRatherThanASecondOne() {
		String subject = somebodyNew();

		UserRef first = signIn(subject);
		UserRef again = signIn(subject);

		assertThat(again).isEqualTo(first);
		assertThat(accountsFor(subject)).containsExactly(first);
		assertThat(subscriptions()).hasSize(1);
	}

	/** And two subjects are two people, each with their own account and their own period. */
	@Test
	void butTwoSubjectsAreTwoAccounts() {
		UserRef one = signIn(somebodyNew());
		UserRef other = signIn(somebodyNew());

		assertThat(other).isNotEqualTo(one);
		assertThat(subscriptions()).hasSize(2)
				.extracting(subscription -> subscription.get("app_user_id"))
				.containsExactlyInAnyOrder(one.id(), other.id());
	}

	/**
	 * And the invariant as a property of the table rather than of one row at a time: whichever path a request
	 * took — a subject seen for the first time, one coming back, a second person — {@code app_user} is left
	 * holding nobody without a subscription.
	 *
	 * <p>The tests above each assert what one call left behind, which is the weaker thing: they would all
	 * still pass if some later path through {@link UserRef} resolution handed back an account it had not
	 * subscribed, because none of them looks at the accounts it did not create. This is the shape of assertion
	 * that would not. The count beside it is what stops it passing vacuously — an empty table also holds no
	 * account without a subscription, and a {@code signIn} that had quietly stopped provisioning anything at
	 * all would otherwise read as green.
	 *
	 * <p>Not an {@code @AfterEach} over the whole file, though it reads like one:
	 * {@link #andASubjectClaimedWhileTheCallWasInFlightJoinsThatAccount} claims a row on a connection of this
	 * suite's own, standing in for another request that would have subscribed it — so the state this forbids
	 * is exactly what that fixture exists to leave behind.
	 */
	@Test
	void andNoAccountIsLeftWithoutOneWhicheverWayItWasReached() {
		String comingBack = somebodyNew();
		signIn(comingBack);
		signIn(comingBack);
		signIn(somebodyNew());

		assertThat(accountsWithNoSubscription()).isEmpty();
		assertThat(accounts()).isEqualTo(2);
	}

	/**
	 * Two of the same person's first requests can be in flight at once — the popup and the dashboard waking
	 * together after a sign-in — and the one that reaches the insert second has to join the account the first
	 * created rather than fail on {@code app_user_idp_subject_key} on its very first call.
	 * {@code on conflict (idp_subject) do nothing} is what makes its insert wait on the other transaction
	 * instead of raising, and the select after it is what turns the nothing it then returns into an answer.
	 *
	 * <p>Arranged rather than raced, because a test that only sometimes races is one that only sometimes
	 * proves anything — eight callers at once left the dropped {@code on conflict} passing. So the competing
	 * account is claimed on a connection of this suite's own and left uncommitted: the call is fired, and this
	 * waits until Postgres reports a backend blocked on a lock — which is the application's insert, stopped on
	 * exactly the row about to be committed — before committing it.
	 *
	 * <p>What this connection stands in for is another request through this same code, which is why nothing
	 * here asserts a subscription: in production the caller that won the insert provisions one in its own
	 * transaction, and the subject of this test is the caller that lost.
	 */
	@Test
	void andASubjectClaimedWhileTheCallWasInFlightJoinsThatAccount() throws Exception {
		String subject = somebodyNew();
		try (Connection somebodyElse = this.database.getConnection()) {
			somebodyElse.setAutoCommit(false);
			UserRef claimedElsewhere = new UserRef(claim(somebodyElse, subject));

			Future<HttpResponse<String>> inFlight = whileThisIsUncommitted(
					() -> get(ACCOUNT, IDP.token(claims -> claims.subject(subject))));
			somebodyElse.commit();

			HttpResponse<String> answered = inFlight.get(30, TimeUnit.SECONDS);
			assertThat(answered.statusCode()).isEqualTo(200);
			assertThat(userRefIn(answered)).isEqualTo(claimedElsewhere);
			assertThat(accountsFor(subject)).containsExactly(claimedElsewhere);
		}
	}

	/**
	 * The invariant, asserted where it could actually break rather than only on the happy path: an account is
	 * provisioned in the transaction that provisions its subscription, so a catalog that cannot supply a tier
	 * leaves <strong>no account behind at all</strong>. The caller sees the failure and their next request
	 * tries again; what they never become is a signed-up user with nothing to spend, which is the state every
	 * reader of a subscription would then have to be written to survive.
	 *
	 * <p>The catalog is put back by hand rather than by a rollback, since the application writes on its own
	 * connection and would not see one.
	 */
	@Test
	void aCatalogWithNoDefaultTierProvisionsNobodyAtAll() {
		String subject = somebodyNew();
		this.db.update("update tier set is_default = false");
		try {
			HttpResponse<String> failed = get(ACCOUNT, IDP.token(claims -> claims.subject(subject)));

			assertThat(failed.statusCode()).isEqualTo(500);
			assertThat(accountsFor(subject)).isEmpty();
			assertThat(subscriptions()).isEmpty();
		}
		finally {
			this.db.update("update tier set is_default = true where code = 'free'");
		}
	}

	/** A call with no token provisions nobody, because it never reaches a handler at all. */
	@Test
	void andACallWithNoTokenProvisionsNobodyEither() {
		HttpResponse<String> refused = get(ACCOUNT, null);

		assertThat(refused.statusCode()).isEqualTo(401);
		assertThat(accounts()).isZero();
	}

	/**
	 * And neither does one at a route that lets it through, which is the half the test above cannot show:
	 * every route in this application is closed today, so the chain refuses that call before any resolver
	 * runs, and a resolver that provisioned for an anonymous caller would pass it. There is no open route to
	 * try it against, so the fixture below adds one.
	 *
	 * <p>That the handler was never entered is the assertion, not the status. Asking for an account is a
	 * <em>write</em>, so the failure that matters is not "the caller saw an error" — it is a row created for
	 * somebody who never signed in, at whatever open route a later ticket adds.
	 */
	@Test
	void andNorDoesOneAtARouteThatWouldHaveLetItThrough() {
		int entered = Account.ANONYMOUSLY.get();

		HttpResponse<String> refused = get(ANONYMOUS_ACCOUNT, null);

		assertThat(refused.statusCode()).isEqualTo(401);
		assertThat(Account.ANONYMOUSLY).hasValue(entered);
		assertThat(accounts()).isZero();
	}

	// --- the routes under test, which this application does not ship yet --------------------------------

	@TestConfiguration(proxyBeanMethods = false)
	static class ProbeRoute {

		@Bean
		Account account() {
			return new Account();
		}

		/** Ordered ahead of the application's own chain, so this matcher wins for the one open route. */
		@Bean
		@Order(0)
		SecurityFilterChain aRouteThatPermitsAnonymousAccess(HttpSecurity http) throws Exception {
			return http.securityMatcher(ANONYMOUS_ACCOUNT)
					.authorizeHttpRequests(routes -> routes.anyRequest().permitAll())
					.build();
		}

	}

	@RestController
	static class Account {

		/**
		 * The whole of the fixture: a handler that asks for the caller's account and says which one it got.
		 * Provisioning happens before this body runs, so the ordinary answer is the id of a row that already
		 * exists — which is what {@code UserRef} promises and what #22 will rely on.
		 */
		@GetMapping(ACCOUNT)
		Map<String, Object> account(UserRef caller) {
			return Map.of("id", caller.id().toString());
		}

		@GetMapping(ANONYMOUS_ACCOUNT)
		Map<String, Object> anonymously(UserRef caller) {
			ANONYMOUSLY.incrementAndGet();
			return account(caller);
		}

		/** How often the handler above was entered, which is what "the resolver refused" actually means. */
		static final AtomicInteger ANONYMOUSLY = new AtomicInteger();

	}

	// --- arrangement and reading back -------------------------------------------------------------------

	/** A subject no earlier test can have provisioned, since two of them assert the whole table. */
	private static String somebodyNew() {
		return UUID.randomUUID().toString();
	}

	private UserRef signIn(String subject) {
		HttpResponse<String> answered = get(ACCOUNT, IDP.token(claims -> claims.subject(subject)));
		assertThat(answered.statusCode()).isEqualTo(200);
		return userRefIn(answered);
	}

	private static UserRef userRefIn(HttpResponse<String> answered) {
		return new UserRef(UUID.fromString(Json.of(answered).get("id").asString()));
	}

	private HttpResponse<String> get(String path, String token) {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + this.port + path))
				.timeout(Duration.ofSeconds(20));
		return Http.send((token == null ? request : request.header("Authorization", "Bearer " + token)).GET().build());
	}

	/** An account claimed but not committed, which is the state the call under test has to arrive into. */
	private static UUID claim(Connection uncommitted, String idpSubject) throws SQLException {
		try (PreparedStatement claim = uncommitted
				.prepareStatement("insert into app_user (idp_subject) values (?) returning id")) {
			claim.setString(1, idpSubject);
			try (ResultSet claimed = claim.executeQuery()) {
				claimed.next();
				return claimed.getObject(1, UUID.class);
			}
		}
	}

	/**
	 * Starts the call and returns once it is provably blocked on the uncommitted row, so that the caller can
	 * commit knowing the application is already waiting rather than hoping it will be. Returning early is the
	 * one failure this could have: the application would then find the row with its own select and never reach
	 * the insert, which is the statement the test is about.
	 */
	private Future<HttpResponse<String>> whileThisIsUncommitted(Callable<HttpResponse<String>> call) {
		ExecutorService caller = Executors.newSingleThreadExecutor();
		try {
			Future<HttpResponse<String>> inFlight = caller.submit(call);
			// The application's insert waits on the claiming transaction's id, which Postgres reports as a
			// backend blocked on a Lock. Thirty seconds, because reaching that insert means going through a
			// whole first login first.
			BlockedBackends.awaitAtLeast(1, this.db, Duration.ofSeconds(30));
			return inFlight;
		}
		finally {
			caller.shutdown();
		}
	}

	private List<UserRef> accountsFor(String idpSubject) {
		return this.db.queryForList("select id from app_user where idp_subject = ?", UUID.class, idpSubject).stream()
				.map(UserRef::new).toList();
	}

	private List<Map<String, Object>> subscriptions() {
		return this.db.queryForList("select app_user_id, tier_id, status from subscription");
	}

	/** The state ADR-0014 rules out, asked for directly rather than inferred from a row that is there. */
	private List<UserRef> accountsWithNoSubscription() {
		return this.db.queryForList("""
				select account.id from app_user account
				left join subscription on subscription.app_user_id = account.id
				where subscription.id is null
				""", UUID.class).stream().map(UserRef::new).toList();
	}

	private Map<String, Object> theOnlySubscription() {
		List<Map<String, Object>> subscriptions = subscriptions();
		assertThat(subscriptions).hasSize(1);
		return subscriptions.get(0);
	}

	private Integer accounts() {
		return this.db.queryForObject("select count(*) from app_user", Integer.class);
	}

	private UUID theDefaultTier() {
		return this.db.queryForObject("select id from tier where is_default", UUID.class);
	}

	/** Read in UTC, because that is the offset the row was written in and a comparison is not about offsets. */
	private OffsetDateTime storedInstant(String column) {
		return this.db.queryForObject("select " + column + " from subscription", OffsetDateTime.class)
				.withOffsetSameInstant(ZoneOffset.UTC);
	}

	@Autowired
	private JdbcTemplate db;

	/** For the one test that needs a connection of its own, held open across a call the application makes. */
	@Autowired
	private DataSource database;

	@LocalServerPort
	private int port;

	private static final String ACCOUNT = "/probe/account";

	private static final String ANONYMOUS_ACCOUNT = "/probe/anonymous/account";

}
