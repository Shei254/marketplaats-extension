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
	 * The value {@code application.yml} gives {@code key} with the substitution resolved — {@code ${NAME:x}}
	 * read as {@code x}, which is what the application starts with when nothing sets {@code NAME}.
	 *
	 * <p>For the readers whose subject is the <em>address</em> a setting names rather than the text of the
	 * line: {@link CrossOriginTest} parses {@code mprelist.web.base-url} as a URL, and a URL is not what
	 * {@code ${MPRELIST_WEB_BASE_URL:http://localhost:5173}} is. Everything else here still reads the literal,
	 * including {@link EnvironmentFileTest}, whose whole subject is which names are substituted at all.
	 */
	static String defaultedInApplicationYaml(String key) {
		String written = inApplicationYaml(key);
		Matcher substitution = Pattern.compile("^\\$\\{[A-Z][A-Z0-9_]*:(.*)}$").matcher(written);
		return substitution.matches() ? substitution.group(1) : written;
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
