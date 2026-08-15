package com.mprelist;

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
			throw new IllegalStateException(InfraFiles.composeFile() + " no longer names a " + repository + " image; "
					+ "the tests take theirs from it so that what they prove is proved on the version the stack serves");
		}
		return image.group(1);
	}

	/**
	 * The value compose sets a key to, for the assertions that hold this application's own configuration against
	 * the stack it will be run beside — {@code KC_HOSTNAME} against {@code issuer-uri} being the one that breaks
	 * a developer's first sign-in when the two drift.
	 *
	 * @param key the setting exactly as compose spells it
	 */
	static String setting(String key) {
		return YamlSetting.in(text(), key, InfraFiles.composeFile().toString());
	}

	/** The file's own text, for the few assertions whose subject is how the stack is wired rather than a tag. */
	static String text() {
		return InfraFiles.textOf(InfraFiles.composeFile());
	}

	private ComposeFile() {
	}

}
