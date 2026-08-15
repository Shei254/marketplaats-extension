package com.mprelist;

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

	private YamlSetting() {
	}

}
