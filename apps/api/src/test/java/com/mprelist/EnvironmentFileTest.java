package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.junit.jupiter.api.Test;

/**
 * The repository's one env file, and whether its committed example still describes the application it is for.
 *
 * <p><strong>An example env file goes stale silently, which is the whole reason this exists.</strong> A
 * setting arrives in {@code application.yml} or in {@code infra/docker-compose.yml}, nobody adds a line for
 * it, and the first person to find out is whoever spends an afternoon on a stack that signs nobody in — or
 * worse, on one whose realm imported with the wrong redirect URI, which is a {@code down -v} rather than a
 * restart. So the two directions are asserted: everything that reads the environment is named in the example,
 * and everything named in the example is read by something.
 *
 * <p>No Spring context and no container: these are four files read as text. The one thing it deliberately
 * does <em>not</em> read is {@code .env} itself — that file is gitignored, is different on every machine, and
 * is loaded into this JVM by {@code build.gradle.kts} rather than looked at by any test.
 */
class EnvironmentFileTest {

	/**
	 * Every {@code ${…}} substitution in {@code application.yml} has a line in the example — the Stripe
	 * secrets and the extension id today.
	 *
	 * <p>The defaults in that file are what make the application start without any of them, which is a
	 * deliberate property (a developer working on something else needs no Stripe account). What the example is
	 * for is the developer who <em>does</em> need one and would otherwise be reading a YAML file to find out
	 * what it is called.
	 */
	@Test
	void everySettingTheApiTakesFromTheEnvironmentIsNamedInTheExample() {
		assertThat(namedInTheExample()).containsAll(substitutedIn(YamlSetting.applicationYaml()));
	}

	/**
	 * And so is everything the local stack passes through to Keycloak: the variables the compose file names
	 * with <em>no value</em>, which is its way of saying "from the environment, if there is one".
	 *
	 * <p>These are the expensive ones. The realm imports on first start only, so a variable that was unset at
	 * the first {@code up} is not something a restart fixes.
	 */
	@Test
	void andSoIsEverythingTheStackPassesThroughToKeycloak() {
		assertThat(namedInTheExample()).containsAll(passedThroughByCompose());
	}

	/**
	 * And nothing in it is read by nobody. The reverse direction, because a variable that outlived whatever
	 * read it is a line somebody will set and then wonder about — and the file is documentation before it is
	 * configuration.
	 *
	 * <p>Scoped to this application's own {@code MPRELIST_} namespace, because the file legitimately carries
	 * settings for the <em>tools</em> a developer runs it with — {@code TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE}
	 * is read by Testcontainers on one flavour of Docker, and no file of ours has any reason to mention it.
	 */
	@Test
	void andNothingInItIsReadByNobody() {
		Set<String> read = new LinkedHashSet<>(substitutedIn(YamlSetting.applicationYaml()));
		read.addAll(passedThroughByCompose());

		assertThat(namedInTheExample().stream().filter(name -> name.startsWith("MPRELIST_")).toList())
				.isSubsetOf(read);
	}

	/**
	 * The extension id the example suggests is the one this application defaults to — and that default is held
	 * to the {@code key} the manifest pins the extension with by
	 * {@code CrossOriginTest.theOriginThisApiAllowsIsDerivedFromTheKeyTheExtensionIsPinnedBy}.
	 *
	 * <p>Asserted against the default rather than by deriving the id a second time, so that one place in this
	 * suite knows Chrome's derivation and everything else is held to it. A literal that has gone stale is
	 * worth catching here because this one reaches the realm, where wrong costs a {@code down -v}: recompute
	 * it with {@code npm run -s extension-id -w @mprelist/extension}.
	 */
	@Test
	void theExtensionIdItSuggestsIsTheOneThisApiDefaultsTo() {
		String allowedOrigin = YamlSetting.inApplicationYaml("allowed-origins");
		String pinnedId = allowedOrigin.substring(allowedOrigin.indexOf(':', "chrome-extension://".length()) + 1,
				allowedOrigin.length() - 1);

		assertThat(valueInTheExample("MPRELIST_EXTENSION_ID")).isEqualTo(pinnedId);
	}

	/**
	 * Nothing the realm substitutes ships as an empty assignment, which is a distinction with a
	 * {@code down -v} behind it.
	 *
	 * <p>Compose hands an empty value to Keycloak as a variable that is <em>defined and empty</em>, and a
	 * realm file's {@code ${MPRELIST_SMTP_HOST:sandbox.smtp.mailtrap.io}} default applies only where the
	 * variable is <em>absent</em>. So {@code MPRELIST_SMTP_HOST=} in a copied {@code .env} does not mean
	 * "use the default", it means "no mail host" — and the same line for the extension id means a realm
	 * registering {@code chrome-extension:///} as its redirect URI, imported once and fixable only by
	 * dropping the volume. Anything without a value belongs commented out; the two Stripe secrets are not
	 * here because nothing in the realm reads them and {@code application.yml} defaults them to empty anyway.
	 */
	@Test
	void nothingTheRealmSubstitutesShipsAsAnEmptyValue() {
		assertThat(substitutedIn(InfraFiles.textOf(InfraFiles.keycloakRealm())))
				.allSatisfy(name -> assertThat(assignedInTheExample(name))
						.withFailMessage(".env.example assigns %s an empty value. Compose passes that to "
								+ "Keycloak as defined-and-empty, which defeats the realm's own default for "
								+ "it — comment the line out instead.", name)
						.isNotEqualTo(""));
	}

	/**
	 * And no real secret is committed in it. Every credential line ships empty or commented, so that filling
	 * one in is a deliberate act in a file git will not take — the failure this guards against is somebody's
	 * working {@code .env} being pasted over the example and pushed.
	 */
	@Test
	void andNoRealSecretIsCommittedInIt() {
		assertThat(InfraFiles.textOf(InfraFiles.environmentExample()).lines()
				.filter(line -> line.matches("^#?\\s*[A-Z][A-Z0-9_]*=.+")))
				.allSatisfy(line -> assertThat(line)
						.doesNotContain("sk_").doesNotContain("rk_").doesNotContain("whsec_"));
	}

	/**
	 * And the file it is an example of is one git never takes. This is the line the whole arrangement's safety
	 * rests on: one file holding every credential is a good idea exactly as long as it cannot be committed.
	 */
	@Test
	void theFileItIsAnExampleOfIsNeverCommitted() {
		assertThat(InfraFiles.textOf(InfraFiles.gitignore()).lines().map(String::trim))
				.contains("/.env");
	}

	// --- reading the three files ------------------------------------------------------------------------

	/** The names {@code ${NAME:default}} the YAML substitutes, whatever each one defaults to. */
	private static Set<String> substitutedIn(String yaml) {
		return Pattern.compile("\\$\\{([A-Z][A-Z0-9_]*)").matcher(yaml).results()
				.map(substitution -> substitution.group(1))
				.collect(Collectors.toCollection(LinkedHashSet::new));
	}

	/**
	 * The compose file's own passthrough: an {@code environment:} entry written as a name and a colon with
	 * nothing after it, which takes whatever the shell — or {@code --env-file} — holds. One with a value is
	 * the stack's own decision and is not a developer's to set, which is why {@code MPRELIST_SSL_REQUIRED} is
	 * not in the example.
	 */
	private static Set<String> passedThroughByCompose() {
		return Pattern.compile("^\\s+([A-Z][A-Z0-9_]*):\\s*$", Pattern.MULTILINE)
				.matcher(InfraFiles.textOf(InfraFiles.composeFile())).results()
				.map(entry -> entry.group(1))
				.collect(Collectors.toCollection(LinkedHashSet::new));
	}

	/**
	 * Every variable the example names, whether it ships with a value or commented out — a commented line is
	 * still the file telling you what the variable is called, which is most of what it is for.
	 */
	private static Set<String> namedInTheExample() {
		return Pattern.compile("^#?\\s*([A-Z][A-Z0-9_]*)=", Pattern.MULTILINE)
				.matcher(InfraFiles.textOf(InfraFiles.environmentExample())).results()
				.map(line -> line.group(1))
				.collect(Collectors.toCollection(LinkedHashSet::new));
	}

	private static String valueInTheExample(String name) {
		String assigned = assignedInTheExample(name);
		if (assigned == null) {
			throw new IllegalStateException(".env.example no longer assigns " + name);
		}
		return assigned;
	}

	/**
	 * What the example assigns a variable, or {@code null} where it names it only as a commented line —
	 * which is the shape "you have no value for this yet" takes here, and is not the same as an empty value.
	 */
	private static String assignedInTheExample(String name) {
		Matcher line = Pattern.compile("^" + Pattern.quote(name) + "=(.*)$", Pattern.MULTILINE)
				.matcher(InfraFiles.textOf(InfraFiles.environmentExample()));
		return line.find() ? line.group(1).trim() : null;
	}

}
