package com.mprelist;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * A Postgres for the tests to migrate, running the image {@code infra/docker-compose.yml} runs — which is
 * where the name comes from, and the whole of the coupling. {@code @ServiceConnection} points
 * {@code spring.datasource} at it, so the container stands in for the local stack for the duration of the
 * suite and no test needs that stack up.
 *
 * <p>Any test class importing this shares one container: the Spring context cache keys on the
 * configuration, so a second class with the same import reuses the first one's context and its beans.
 */
@TestConfiguration(proxyBeanMethods = false)
class PostgresFromCompose {

	@Bean
	@ServiceConnection
	PostgreSQLContainer postgres() {
		return new PostgreSQLContainer(ComposeFile.image("postgres"));
	}

}
