package com.mprelist;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A scalar read out of a YAML file's own text.
 *
 * <p>Two files are read this way and for the same reason: {@code infra/docker-compose.yml}, which is on no
 * classpath, and {@code application.yml}, whose {@code issuer-uri} {@link ResourceServerTest} overrides at
 * runtime and so cannot ask the running configuration for. Both are read to hold this application's
 * configuration and the stack it is run beside in step, and a second copy of the pattern below is a second
 * thing that can be got wrong.
 *
 * <p>A regex rather than a YAML parser, because the subject of those assertions is the literal a human edits:
 * a parser would resolve an anchor or a merge key into a value neither file actually spells, and it is the
 * spelling that has to agree.
 */
final class YamlSetting {

	/**
	 * The value {@code application.yml} gives {@code key}, read out of the file's own text off the test
	 * classpath.
	 *
	 * <p>Two suites now ask this and neither can ask the running configuration instead:
	 * {@link ResourceServerTest} overrides the {@code issuer-uri} it is about, and
	 * {@link ReservationReconciliationTest} overrides the interval it is about. Both are asking what the
	 * application <em>ships</em> with, which is the one copy of a setting a test that overrides it can still
	 * be wrong about.
	 */
	static String inApplicationYaml(String key) {
		return in(applicationYaml(), key, "application.yml");
	}

	/**
	 * The value {@code yaml} gives {@code key}, as it is written.
	 *
	 * @param yaml the file's own text
	 * @param key the setting exactly as the file spells it
	 * @param source what to name in the failure, so that it says which file stopped setting it
	 */
	static String in(String yaml, String key, String source) {
		Matcher value = Pattern.compile("^\\s*" + Pattern.quote(key) + ":\\s*(\\S+)\\s*$", Pattern.MULTILINE)
				.matcher(yaml);
		if (!value.find()) {
			throw new IllegalStateException(source + " no longer sets " + key + ", which these tests read to hold "
					+ "this application's configuration and the local stack in step");
		}
		return value.group(1);
	}

	/**
	 * The whole of {@code application.yml}, for the one reader that is about the file rather than about a
	 * setting in it: {@link EnvironmentFileTest} asks which environment variables it names at all.
	 */
	static String applicationYaml() {
		try (var yaml = YamlSetting.class.getResourceAsStream("/application.yml")) {
			return new String(yaml.readAllBytes());
		}
		catch (IOException unreadable) {
			throw new UncheckedIOException("Cannot read application.yml off the classpath", unreadable);
		}
	}

	private YamlSetting() {
	}

}
