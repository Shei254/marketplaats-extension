package com.mprelist;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * {@code infra/docker-compose.yml}, read rather than restated.
 *
 * <p>Two tests here start a container of their own instead of using the local stack, and both would be
 * worthless run against a different version than the stack serves: a schema proven on one Postgres major
 * and then served by another, or a realm proven on one Keycloak and then imported by another, is a
 * divergence nothing reports until deploy — and these files are edited months apart.
 */
final class ComposeFile {

	/**
	 * The tag compose gives {@code repository}, so that a version bump there moves the tests with it.
	 *
	 * @param repository the image name without its tag, exactly as compose spells it
	 */
	static String image(String repository) {
		Matcher image = Pattern.compile("^\\s*image:\\s*(" + Pattern.quote(repository) + ":\\S+)\\s*$",
				Pattern.MULTILINE).matcher(text());
		if (!image.find()) {
			throw new IllegalStateException(path() + " no longer names a " + repository + " image; the tests take "
					+ "theirs from it so that what they prove is proved on the version the stack serves");
		}
		return image.group(1);
	}

	/** The file's own text, for the few assertions whose subject is how the stack is wired rather than a tag. */
	static String text() {
		Path compose = path();
		try {
			return Files.readString(compose);
		}
		catch (IOException failed) {
			throw new UncheckedIOException("Cannot read " + compose + ", which names the containers these tests run",
					failed);
		}
	}

	/** A path under the repository root, resolved the same way whatever directory the tests were started in. */
	static Path sibling(String relativePath) {
		return repositoryRoot().resolve(relativePath);
	}

	static Path path() {
		return sibling(RELATIVE_PATH);
	}

	/**
	 * Walks up from the working directory, which is this Gradle project under {@code ./gradlew} and can
	 * be the repository root or an IDE's own choice otherwise.
	 */
	private static Path repositoryRoot() {
		Path start = Path.of("").toAbsolutePath();
		for (Path directory = start; directory != null; directory = directory.getParent()) {
			if (Files.isRegularFile(directory.resolve(RELATIVE_PATH))) {
				return directory;
			}
		}
		throw new IllegalStateException("No " + RELATIVE_PATH + " in " + start + " or any directory above it");
	}

	private ComposeFile() {
	}

	private static final String RELATIVE_PATH = "infra/docker-compose.yml";
}
