package com.mprelist.subscription.internal;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import com.mprelist.catalog.TierCatalog;
import com.mprelist.identity.UserProvisioned;

/**
 * The half of first login that makes ADR-0014's "no subscription is unreachable" true: an account is created
 * and lands on the default tier, {@code active}, with a period, in the same transaction.
 *
 * <p>So nothing in this application ever asks "is this user free?". The free tier is an ordinary row with no
 * Stripe Price, the gate reads an Entitlement either way, and {@code SUBSCRIPTION_INACTIVE} can only ever mean
 * a payer whose subscription lapsed — never "has not signed up", which is the ambiguity a nullable
 * subscription would have introduced into every branch that reads one.
 */
@Component
class ProvisionOnFirstLogin {

	ProvisionOnFirstLogin(JdbcClient db, TierCatalog tiers) {
		this.db = db;
		this.tiers = tiers;
	}

	/**
	 * Synchronous and unannotated, which is what keeps it inside the transaction {@code identity} opened to
	 * create the account. Nothing here catches anything: a catalog with no default tier, or a second
	 * subscription for one account, has to take the {@code app_user} row down with it rather than leave an
	 * account behind that this application would then treat as a signed-up user with nothing to spend.
	 *
	 * <p>No {@code on conflict do nothing} on the insert for the same reason. The unique on
	 * {@code subscription.app_user_id} would swallow a duplicate quietly, and a duplicate means the event
	 * fired twice for one account — a bug in provisioning, which should be loud.
	 */
	@EventListener
	void onlyEverOnce(UserProvisioned account) {
		// The clock is read once, so period_start is when the account was provisioned and period_end is a
		// month after that same instant rather than after a second reading of `now()`.
		OffsetDateTime provisionedAt = OffsetDateTime.now(ZoneOffset.UTC);
		this.db.sql("""
				insert into subscription (app_user_id, tier_id, status, period_start, period_end)
				values (?, ?, 'active', ?, ?)
				""")
				.params(account.user().id(), this.tiers.defaultTier().id(), provisionedAt,
						// A calendar month, not thirty days: `resetAt` is what the popup shows and a window
						// that drifts a day earlier every month is a window nobody can plan around. In UTC and
						// in Java rather than as Postgres's `interval '1 month'`, which is evaluated in the
						// session's own time zone — the same account provisioned by two deployments would then
						// get periods an hour apart across a DST boundary.
						provisionedAt.plusMonths(1))
				.update();
	}

	private final JdbcClient db;

	private final TierCatalog tiers;

}
