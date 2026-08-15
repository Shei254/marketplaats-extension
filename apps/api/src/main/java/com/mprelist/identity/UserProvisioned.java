package com.mprelist.identity;

/**
 * An {@code app_user} row has just been created, which is this application's whole notion of "first login" —
 * it is a resource server and has no login of its own, so the first request carrying a subject it has never
 * seen is the event.
 *
 * <p>Published once per account, ever. The insert behind it is the one that won the unique index on
 * {@code idp_subject}, so two concurrent first calls raise this once and a returning caller raises it not at
 * all.
 *
 * <p><strong>Listeners run inside the transaction that created the row</strong>, which is the point of this
 * being an ordinary {@link org.springframework.context.event.EventListener} rather than Spring Modulith's
 * {@code @ApplicationModuleListener}. That one is asynchronous and after-commit, so an account would exist
 * for a moment with nothing else provisioned against it — and ADR-0014's "no subscription is unreachable" is
 * an invariant rather than an eventual state. A listener that throws takes the account with it: the caller
 * gets an error and the next request tries again, which is the only failure mode that leaves nothing
 * half-provisioned behind.
 *
 * <p>An event rather than {@code identity} calling {@code subscription} directly, because the dependency
 * would point the wrong way. A subscription references a user; everything references identity. This lets
 * {@code subscription} — and whatever else a later ticket hangs off a new account — depend on identity
 * without identity knowing any of them exist.
 *
 * @param user the account that was created
 */
public record UserProvisioned(UserRef user) {

	public UserProvisioned {
		if (user == null) {
			throw new IllegalArgumentException("An account was provisioned, so there is one to name");
		}
	}

}
