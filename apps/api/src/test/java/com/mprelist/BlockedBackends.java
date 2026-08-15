package com.mprelist;

import static org.awaitility.Awaitility.await;

import java.time.Duration;

import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Waits until Postgres reports that many backends stopped on a lock.
 *
 * <p>Two suites arrange a race the same way — take a row, start the call that will want it, and let it commit
 * only once the application is provably waiting — and both need the same answer to "is it waiting yet?".
 * Asking the database rather than sleeping is what makes those tests an arrangement rather than a race with a
 * longer fuse, and the predicate that does the asking is worth one home: {@code wait_event_type} is a column
 * whose spelling a Postgres major could change, and a query that silently matched nothing would turn both
 * suites into tests that pass without ever having arranged anything.
 */
final class BlockedBackends {

	/**
	 * @param backends how many the caller has arranged to be waiting — the application's own read of the row
	 * this suite is holding, one per concurrent caller
	 * @param atMost how long to wait before the arrangement is declared to have failed, which is per-suite
	 * because what is being waited for differs: a lock taken inside one transaction is quicker to reach than
	 * one behind a whole first-login insert
	 */
	static void awaitAtLeast(int backends, JdbcTemplate db, Duration atMost) {
		await().atMost(atMost)
				.until(() -> db.queryForObject("select count(*) from pg_stat_activity where wait_event_type = 'Lock'",
						Integer.class) >= backends);
	}

	private BlockedBackends() {
	}

}
