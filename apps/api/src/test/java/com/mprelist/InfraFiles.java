package com.mprelist;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * The files this suite reads out of the working tree rather than off the classpath — {@code infra/}'s, the
 * root {@code brand.json}, the extension manifest whose pinned key this application's allowed origin is
 * derived from, and ADR-0012, whose module tree {@code ModuleBoundaryTest} holds to the packages.
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

	/**
	 * The deployed stack (T55, #86), which no test starts and every test that reads it is about a difference
	 * between it and the file above — a credential that is committed in one and must not be in the other, a
	 * Keycloak in development mode, a port published to nobody's benefit.
	 */
	static Path productionComposeFile() {
		return repositoryRoot().resolve("infra/docker-compose.prod.yml");
	}

	/** Its committed example environment, which is to it what {@link #environmentExample()} is to the stack. */
	static Path productionEnvironmentExample() {
		return repositoryRoot().resolve("infra/production.env.example");
	}

	/** The realm {@link KeycloakFromCompose} imports, mounted into a container rather than read here. */
	static Path keycloakRealm() {
		return repositoryRoot().resolve("infra/keycloak/mprelist-realm.json");
	}

	/**
	 * The realm a <em>deployment</em> imports (T56, #87) — the one {@code MPRELIST_REALM_DIR} points at, with
	 * no dev users in it and every origin a {@code ${…}} substitution.
	 *
	 * <p>It is imported on first start and never again while that database exists, so the whole of the cost
	 * of it being wrong is a {@code down -v} on production. {@code ProductionRealmTest} starts a Keycloak on
	 * it for that reason: this is the file in this repository whose mistakes are the most expensive and the
	 * least visible.
	 */
	static Path productionKeycloakRealm() {
		return repositoryRoot().resolve("infra/keycloak-production/mprelist-realm.json");
	}

	/** The proxy in front of the deployed stack, which is the only thing on that host that binds a port. */
	static Path caddyfile() {
		return repositoryRoot().resolve("infra/caddy/Caddyfile");
	}

	/**
	 * Everything a user sees the product called (T48, #78). Read here for one field of it: the realm above
	 * carries a {@code displayName}, which is the product's name on the page somebody signs in on — and it
	 * is the one copy of that name outside the file that is supposed to hold the only one.
	 */
	static Path brandFile() {
		return repositoryRoot().resolve("brand.json");
	}

	/**
	 * The extension's manifest template, read for the one thing in it this application also states: the
	 * {@code key} the extension's id is derived from (T44), which is the origin CORS allows.
	 *
	 * <p>The only file here from outside {@code infra/}, and the class keeps its name because what these
	 * have in common is being read out of the working tree rather than off a classpath — with the same
	 * consequence for {@code build.gradle.kts}, which has to declare it an input or an edit to it leaves the
	 * previous run's verdict standing.
	 */
	static Path extensionManifest() {
		return repositoryRoot().resolve("apps/extension/public/manifest.template.json");
	}

	/**
	 * The committed example of the one file this repository takes credentials from — {@code .env} itself is
	 * gitignored and is never read by a test, only loaded into the JVM one runs in ({@code build.gradle.kts}).
	 *
	 * <p>Read here because an example env file is the kind of thing that goes stale silently: a setting
	 * arrives in {@code application.yml} or in the compose file, nobody adds it, and the first person to
	 * notice is whoever spends an afternoon on a stack that will not sign anybody in.
	 */
	static Path environmentExample() {
		return repositoryRoot().resolve(".env.example");
	}

	/** Read for one line of it, and it is the line that keeps the file above from being committed by mistake. */
	static Path gitignore() {
		return repositoryRoot().resolve(".gitignore");
	}

	/**
	 * The ADR whose tree names what each module lets another see, read by {@code ModuleBoundaryTest} so that
	 * the rule it states — <em>a ticket that adds to one amends them here</em> — is enforced rather than
	 * remembered. It is a document rather than a config file, and it is here for the same reason the rest
	 * are: it is read from the working tree, so {@code build.gradle.kts} has to call it an input or an edit
	 * to it leaves the previous run's verdict standing.
	 */
	static Path moduleArchitectureAdr() {
		return repositoryRoot().resolve("docs/adr/0012-backend-modular-monolith.md");
	}

	/**
	 * The text of one of the files above. Here rather than at each caller because the failure is the part
	 * worth writing once: these are read out of the working tree, so a file that moved has to say which one
	 * it was rather than arrive as a bare {@code NoSuchFileException} from somewhere inside a test.
	 */
	static String textOf(Path file) {
		try {
			return Files.readString(file);
		}
		catch (IOException unreadable) {
			throw new UncheckedIOException("Cannot read " + file + ", which this suite reads out of the working tree "
					+ "rather than off the classpath", unreadable);
		}
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
