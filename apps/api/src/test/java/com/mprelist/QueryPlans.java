package com.mprelist;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

import javax.sql.DataSource;

/**
 * How Postgres would reach the rows a statement asks for, if reaching for an index were worth it.
 *
 * <p>Two suites now ask this — {@link ReservationReconciliationTest} of the sweep and {@link RelistPacingTest}
 * of the pacing read — and what they share is not a line but a way of asking, whose every part is load-bearing
 * and none of it obvious. A second copy is a second chance to get one of them subtly wrong and assert nothing
 * while passing.
 *
 * <p><strong>Sequential scans are turned off for the question.</strong> These tables hold whatever one test
 * just wrote, and a planner is right to read three rows directly — left on, an assertion about the plan would
 * be an assertion about the size of the fixture. Off, the plan answers the question actually being asked:
 * <em>is there an index that serves this predicate at all?</em> It does not weaken the answer, because a
 * partial index whose predicate the statement does not imply is still not chosen — the planner cannot prove it
 * holds every row the statement wants, at any cost.
 *
 * <p><strong>{@code set local} and a rollback</strong>, so the setting dies with the transaction rather than
 * following the connection back into the pool and quietly planning somebody else's test. And {@code explain}
 * without {@code analyze}, which plans the statement without running it — so this writes nothing even when the
 * subject is an {@code update}.
 */
final class QueryPlans {

	/**
	 * The plan for that statement, as Postgres prints it, with the index names in it.
	 *
	 * @param database the application's own {@link DataSource}, so that what is planned is planned against the
	 * schema the migrations left rather than one a test arranged
	 * @param statement the statement to plan, spelled as the code under test spells it — a literal that became
	 * a bind parameter is exactly the difference a partial index notices, so this is the one assertion where
	 * paraphrasing the SQL would quietly change the subject
	 */
	static String of(DataSource database, String statement) throws SQLException {
		try (Connection planning = database.getConnection()) {
			planning.setAutoCommit(false);
			try (Statement session = planning.createStatement()) {
				session.execute("set local enable_seqscan = off");
				StringBuilder plan = new StringBuilder();
				try (ResultSet lines = session.executeQuery("explain " + statement)) {
					while (lines.next()) {
						plan.append(lines.getString(1)).append('\n');
					}
				}
				planning.rollback();
				return plan.toString();
			}
		}
	}

	private QueryPlans() {
	}

}
