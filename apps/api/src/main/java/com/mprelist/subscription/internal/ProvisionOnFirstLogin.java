package com.mprelist.subscription.internal;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;

import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import com.mprelist.catalog.TierCatalog;
import com.mprelist.catalog.TierId;
import com.mprelist.identity.UserProvisioned;
import com.mprelist.identity.UserRef;

/**
 * The half of first login that makes ADR-0014's "no subscription is unreachable" true: an account is created
 * and lands on the default tier, {@code active}, with a period, in the same transaction.
 *
 * <p>So nothing in this application ever asks "is this user free?". The free tier is an ordinary row with no
 * Stripe Price, the gate reads an Entitlement either way, and {@code SUBSCRIPTION_INACTIVE} can only ever mean
 * a payer whose subscription lapsed — never "has not signed up", which is the ambiguity a nullable
 * subscription would have introduced into every branch that reads one.
 *
 * <p><strong>And since T77 it stops throwing when the catalog has no default</strong>
 * (<a href="../../../../../../../../docs/adr/0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md">ADR-0032</a>).
 * The invariant this class exists to keep is that an account and a subscription are created in one
 * transaction, and that survives untouched; what changes is that the subscription may name nothing yet. The
 * alternative was what was here — an exception that takes the {@code app_user} row down with it — and it was
 * the right answer while an empty catalog could only be corruption. Now it is a state an operator can arrive
 * at deliberately, and refusing to create accounts while they are in it would turn one deleted tier into a
 * sign-in outage nothing on their screen explains.
 */
@Component
class ProvisionOnFirstLogin {

	ProvisionOnFirstLogin(JdbcClient db, TierCatalog tiers) {
		this.db = db;
		this.tiers = tiers;
	}

	/**
	 * Synchronous and unannotated, which is what keeps it inside the transaction {@code identity} opened to
	 * create the account. Nothing here catches anything: a second subscription for one account has to take
	 * the {@code app_user} row down with it rather than leave an account behind that this application would
	 * then treat as a signed-up user with nothing to spend. A catalog with no default tier used to be on that
	 * list and is not any more — see above.
	 *
	 * <p>The status is {@code active} whether or not a tier was named, and that is deliberate: a status is a
	 * statement about Stripe's view of a subscription (ADR-0018), and nobody's card is failing here. What a
	 * tier-less row is denied by is {@code NO_TIER}, which sits above the status check for exactly that
	 * reason — telling a user their payment lapsed when what happened is that their plan was deleted would be
	 * the one denial in the contract that points at the wrong person.
	 *
	 * <p>No {@code on conflict do nothing} on the insert for the same reason. The unique on
	 * {@code subscription.app_user_id} would swallow a duplicate quietly, and a duplicate means the event
	 * fired twice for one account — a bug in provisioning, which should be loud.
	 */
	@EventListener
	void subscribeOnTheDefaultTier(UserProvisioned provisioned) {
		// Both named at their own type before the insert takes them, because from `params` on they are two
		// positional uuids and a pair of those swapped is a subscription belonging to a tier.
		UserRef account = provisioned.user();
		// Empty where the catalog holds no default, which since T77 is a state and not corruption: the row is
		// written naming no tier, and the account is denied NO_TIER until `PUT …/{code}/default` adopts it
		// along with every other orphan.
		Optional<TierId> defaultTier = this.tiers.defaultTier();
		// The clock is read once, so period_start is when the account was provisioned and period_end is a
		// month after that same instant rather than after a second reading of `now()`.
		OffsetDateTime provisionedAt = OffsetDateTime.now(ZoneOffset.UTC);
		this.db.sql("""
				insert into subscription (app_user_id, tier_id, status, period_start, period_end, created_at)
				values (?, cast(? as uuid), 'active', ?, ?, ?)
				""")
				// `cast(? as uuid)` so that "no tier" is a parameter rather than a second insert: an untyped
				// null is one Postgres would have to infer a column type for, and two statements would be two
				// places this row's shape could come to be spelled differently.
				.params(account.id(), defaultTier.map(TierId::id).orElse(null), provisionedAt,
						// A calendar month, not thirty days: `resetAt` is what the popup shows and a window
						// that drifts a day earlier every month is a window nobody can plan around. In UTC and
						// in Java rather than as Postgres's `interval '1 month'`, which is evaluated in the
						// session's own time zone — the same account provisioned by two deployments would then
						// get periods an hour apart across a DST boundary.
						provisionedAt.plusMonths(1),
						// `created_at` is passed rather than left to the column's `default now()`, for the
						// reason `UsageReservations.reserve` passes `reserved_at`: that default is the
						// database's clock and this row's window is the application's, and the two differ by
						// however far apart the machines are. It matters here because `created_at` is the
						// anchor every later roll counts months from — a skew of a few seconds between the
						// anchor and the window it is supposed to have started would move a free user's every
						// subsequent `resetAt` by that much, in a direction nobody chose.
						provisionedAt)
				.update();
	}

	private final JdbcClient db;

	private final TierCatalog tiers;

}
