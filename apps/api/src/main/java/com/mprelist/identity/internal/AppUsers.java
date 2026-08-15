package com.mprelist.identity.internal;

import java.util.Optional;
import java.util.UUID;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.mprelist.identity.UserProvisioned;
import com.mprelist.identity.UserRef;

/**
 * The {@code app_user} table, and where an IdP subject becomes an account of ours.
 *
 * <p>This application is a resource server with no login of its own, so "first login" is the first request
 * carrying a subject the table has never seen. Provisioning is therefore something that happens on the way
 * into a handler rather than at a sign-up endpoint there is nowhere to put — see {@link UserRefFromToken}.
 */
@Service
class AppUsers {

	AppUsers(JdbcClient db, ApplicationEventPublisher provisioned) {
		this.db = db;
		this.provisioned = provisioned;
	}

	/**
	 * The account for a subject, created if this is the first time it has been seen.
	 *
	 * <p>Transactional because provisioning is not only this insert: {@link UserProvisioned} is published to
	 * synchronous listeners, and the {@code subscription} row one of them writes has to be committed with the
	 * account or not at all. A listener that fails takes the {@code app_user} row down with it, so the state
	 * ADR-0014 rules out — a user with no subscription — is never reachable, not even for the moment between
	 * two commits.
	 *
	 * <p>Three statements rather than one because two callers can be the same person's first request. The
	 * select is the ordinary path and costs one hit on {@code app_user_idp_subject_key}; the insert claims the
	 * account and is the only place the event is raised, so a caller that lost the race joins the winner's
	 * account instead of provisioning a second one. {@code on conflict do nothing} is what turns that race
	 * from an error into a second select: it waits on the other transaction and returns nothing once that one
	 * has committed, which is exactly when the row it should be reading is there to read.
	 *
	 * <p>Package-private, which for a long time it could not have been: {@code @Transactional} on a non-public
	 * method used to be ignored rather than rejected, and the atomicity above would have quietly not existed.
	 * {@code AbstractTransactionManagementConfiguration} builds its
	 * {@code AnnotationTransactionAttributeSource} with {@code publicMethodsOnly = false} as of Spring 7, so it
	 * applies. What keeps that from being a thing to remember is that
	 * {@code aCatalogWithNoDefaultTierProvisionsNobodyAtAll} fails the moment the transaction is not there,
	 * whichever way it stopped being.
	 */
	@Transactional
	UserRef accountFor(String idpSubject) {
		Optional<UUID> known = idOf(idpSubject);
		if (known.isPresent()) {
			return new UserRef(known.get());
		}
		Optional<UUID> claimed = this.db
				.sql("insert into app_user (idp_subject) values (?) on conflict (idp_subject) do nothing returning id")
				.param(idpSubject)
				.query(UUID.class)
				.optional();
		if (claimed.isEmpty()) {
			return new UserRef(idOf(idpSubject).orElseThrow(() -> new IllegalStateException(
					"app_user holds no row for a subject the insert would not create either, which means "
							+ "something outside this application is deleting accounts while requests are in "
							+ "flight")));
		}
		UserRef account = new UserRef(claimed.get());
		this.provisioned.publishEvent(new UserProvisioned(account));
		return account;
	}

	private Optional<UUID> idOf(String idpSubject) {
		return this.db.sql("select id from app_user where idp_subject = ?")
				.param(idpSubject)
				.query(UUID.class)
				.optional();
	}

	private final JdbcClient db;

	private final ApplicationEventPublisher provisioned;

}
