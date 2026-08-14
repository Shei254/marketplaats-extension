package com.mprelist;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * The files under {@code infra/} that this suite reads out of the working tree rather than off the classpath.
 *
 * <p>Named here once because three things have to agree on where they are: the tests that read them,
 * {@code build.gradle.kts} — whose {@code inputs.files} is the only reason an edit to either does not leave
 * {@code test} UP-TO-DATE with the previous run's verdict standing — and whoever moves them next. Gradle
 * cannot see these constants, so that copy is the one that has to be kept in step by hand; it is spelled
 * against a single {@code infra} directory there for the same reason this class exists.
 */
final class InfraFiles {

	/** The compose file, which is also the marker the repository root is found by. */
	static Path composeFile() {
		return repositoryRoot().resolve(COMPOSE_FILE);
	}

	/** The realm {@link KeycloakFromCompose} imports, mounted into a container rather than read here. */
	static Path keycloakRealm() {
		return repositoryRoot().resolve("infra/keycloak/mprelist-realm.json");
	}

	/**
	 * Walks up from the working directory, which is this Gradle project under {@code ./gradlew} and can be
	 * the repository root or an IDE's own choice otherwise. One mechanism, so that a test started from a
	 * different directory either finds every one of these files or none of them.
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

	private InfraFiles() {
	}

	private static final String COMPOSE_FILE = "infra/docker-compose.yml";

}
