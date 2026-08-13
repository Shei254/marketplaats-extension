package com.mprelist;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
		return new PostgreSQLContainer(composePostgresImage());
	}

	/**
	 * The image tag read out of the compose file rather than restated here. A schema proven on one
	 * Postgres major and then served by another is a divergence nothing reports until deploy, and these
	 * two files are edited months apart.
	 */
	private static String composePostgresImage() {
		Path compose = repositoryRoot().resolve(COMPOSE_FILE);
		String text;
		try {
			text = Files.readString(compose);
		}
		catch (IOException failed) {
			throw new UncheckedIOException("Cannot read " + compose + ", which names the Postgres these tests run on",
					failed);
		}
		Matcher image = Pattern.compile("^\\s*image:\\s*(postgres:\\S+)\\s*$", Pattern.MULTILINE).matcher(text);
		if (!image.find()) {
			throw new IllegalStateException(compose + " no longer names a postgres image; these tests take theirs "
					+ "from it so that the schema is verified on the version the stack serves");
		}
		return image.group(1);
	}

	/**
	 * Walks up from the working directory, which is this Gradle project under {@code ./gradlew} and can
	 * be the repository root or an IDE's own choice otherwise.
	 */
	private static Path repositoryRoot() {
		Path start = Path.of("").toAbsolutePath();
		for (Path directory = start; directory != null; directory = directory.getParent()) {
			if (Files.isRegularFile(directory.resolve(COMPOSE_FILE))) {
				return directory;
			}
		}
		throw new IllegalStateException("No " + COMPOSE_FILE + " in " + start + " or any directory above it");
	}

	private static final String COMPOSE_FILE = "infra/docker-compose.yml";
}
