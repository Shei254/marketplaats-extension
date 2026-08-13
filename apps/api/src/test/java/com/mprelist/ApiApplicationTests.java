package com.mprelist;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

@SpringBootTest
@Import(PostgresFromCompose.class)
class ApiApplicationTests {

	/**
	 * Starting the context now also runs the migrations against that Postgres, so this fails on a
	 * migration Flyway rejects — a repeated version, a checksum that no longer matches, or SQL Postgres
	 * will not accept.
	 */
	@Test
	void theApplicationContextStarts() {
	}
}
