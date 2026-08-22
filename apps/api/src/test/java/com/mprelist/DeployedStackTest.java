package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.junit.jupiter.api.Test;

/**
 * {@code infra/docker-compose.prod.yml}, and whether it is still a deployment rather than a copy of the
 * laptop (T55, #86).
 *
 * <p><strong>Nothing here starts a container.</strong> What is asserted is the difference between the two
 * compose files, because that difference <em>is</em> the ticket: the same four pieces of software run with
 * none of the settings that make the local stack convenient. Every one of these has a failure mode that is
 * silent from the deployed side — a Keycloak still in development mode serves sign-ins perfectly well, and a
 * realm imported from {@code ./keycloak} gives a stranger the account called {@code dev} with a password this
 * repository publishes.
 *
 * <p>The other half of it is in {@code apps/web}'s own suite ({@code deployed-config.test.ts}), which holds
 * the nginx template to the bundle that reads what it serves — including the one line the backlog names for
 * this ticket, that every public path is answered with the one {@code index.html}.
 */
class DeployedStackTest {

	/**
	 * The two images it runs are the two the local stack runs, tag for tag.
	 *
	 * <p>Everything this suite proves about the schema is proven against the Postgres in
	 * {@code docker-compose.yml}, and everything {@link KeycloakRealmTest} proves is proven against that
	 * Keycloak. Deploying a different major is deploying something nothing has ever tested — and the two
	 * files are edited months apart, by different people, for different reasons.
	 */
	@Test
	void runsTheSameTwoImagesTheLocalStackRuns() {
		for (String repository : new String[] { "postgres", "quay.io/keycloak/keycloak" }) {
			assertThat(imageIn(settings(), repository)).isEqualTo(ComposeFile.image(repository));
		}
	}

	/**
	 * And it runs Keycloak's production mode, which is the whole reason the local one is not fit to deploy.
	 *
	 * <p>{@code start-dev} turns off TLS, hostname strictness and the optimised build. It also starts
	 * perfectly happily, signs people in, and looks exactly like a working deployment.
	 */
	@Test
	void andRunsKeycloakInProductionMode() {
		assertThat(settings()).contains("[\"start\", \"--import-realm\"]").doesNotContain("start-dev");
	}

	/**
	 * And it does not relax {@code sslRequired}, which the local stack does and has to.
	 *
	 * <p>The realm file's own default is {@code ${MPRELIST_SSL_REQUIRED:external}} and {@code external} is
	 * the value that must never be inherited from a laptop: it is what makes Keycloak refuse plain HTTP from
	 * anywhere but a local address. Compose passing the variable through at all would be enough to lose it,
	 * so the assertion is that the name does not appear in this file in any form.
	 */
	@Test
	void andNeverRelaxesTheOneSettingTheLocalStackHasTo() {
		assertThat(settings()).doesNotContain("MPRELIST_SSL_REQUIRED");
		// And the local stack still does relax it, or this is a difference between two files that agree.
		assertThat(ComposeFile.setting("MPRELIST_SSL_REQUIRED")).isEqualTo("none");
	}

	/**
	 * And it imports a realm nobody has to be told is not this one.
	 *
	 * <p>{@code infra/keycloak} holds two users sharing one published password, a thirty-day session and
	 * every redirect URI on {@code localhost}. It is also the obvious thing to point a first deployment at,
	 * and the realm imports on first start only — so the mistake is made once and undone by dropping the
	 * database. The directory is a variable with no default for that reason, and this is the assertion that
	 * it stays one.
	 */
	@Test
	void andImportsARealmThatIsNotTheLocalStackTwo() {
		assertThat(settings()).contains("${MPRELIST_REALM_DIR:?").doesNotContain("./keycloak\n");
	}

	/**
	 * And it commits no credential, which is the line between the two files that has no exceptions.
	 *
	 * <p>Every password in {@code docker-compose.yml} is a well-known default committed on purpose so that
	 * {@code up} needs no setup step. Here, every one is a variable that defaults to nothing at all:
	 * {@code ${NAME:?…}} makes compose refuse to start and name the missing one, at the only moment anybody
	 * is looking, and {@code ${NAME:-}} is the shape of the two that may legitimately be absent — the Stripe
	 * secrets, which T57 (#88) fills in and without which this application starts fail-closed and says so.
	 * What neither of them can be is a value somebody could deploy without choosing it.
	 */
	@Test
	void andCommitsNoCredentialOfItsOwn() {
		Matcher assignment = Pattern.compile("^[ \\t]+(\\w*(?:PASSWORD|ADMIN|SECRET))[ \\t]*:[ \\t]*(\\S.*)$",
				Pattern.MULTILINE).matcher(settings());

		while (assignment.find()) {
			assertThat(assignment.group(2))
					.withFailMessage("%s is given %s in the deployed stack. Every credential there is a variable "
							+ "that defaults to nothing — ${NAME:?why}, so a deployment missing one is refused "
							+ "and told which, or ${NAME:-} for one that may legitimately be absent.",
							assignment.group(1), assignment.group(2))
					.matches("\\$\\{[A-Z0-9_]+(:\\?[^}]*|:-)}");
		}
	}

	/**
	 * And the database is reachable from the two services that need it and from nothing else.
	 *
	 * <p>A published Postgres port is the one mistake here that a deployment cannot recover from by
	 * restarting: what leaks is every subscriber's row and, given the password, everything else too.
	 */
	@Test
	void andPublishesNoDatabasePort() {
		assertThat(serviceIn(settings(), "postgres")).doesNotContain("ports:");
	}

	/**
	 * And it overrides every value {@code application.yml} commits for the local stack.
	 *
	 * <p>Three of the four are loud when they are missing — a container with no Postgres on its own
	 * {@code localhost} fails to start. The issuer is the quiet one: the application starts, Keycloak is up,
	 * and every token that arrives is refused by a resource server trusting a realm on somebody's laptop.
	 */
	@Test
	void andOverridesEveryLocalStackValueTheApiShipsWith() {
		String api = serviceIn(settings(), "api");

		assertThat(YamlSetting.applicationYaml()).contains("jdbc:postgresql://localhost:5432/mprelist");
		assertThat(api)
				.contains("SPRING_DATASOURCE_URL:")
				.contains("SPRING_DATASOURCE_USERNAME:")
				.contains("SPRING_DATASOURCE_PASSWORD:")
				.contains("SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI:");
	}

	/**
	 * And every setting of ours it gives that container is one this application actually reads.
	 *
	 * <p>The failure this catches is a rename: {@code application.yml} stops substituting a name, nothing in
	 * the local stack notices because the default is what a laptop wants anyway, and the deployed value goes
	 * on being set and ignored. {@code MPRELIST_WEB_BASE_URL} is the one that would be worst — a paying
	 * customer sent to a page that does not exist.
	 */
	@Test
	void andEverySettingItGivesTheApiIsOneTheApiReads() {
		Set<String> read = namesMatching("\\$\\{([A-Z][A-Z0-9_]*)", YamlSetting.applicationYaml());

		assertThat(namesMatching("^\\s+(MPRELIST_[A-Z0-9_]*)\\s*:", serviceIn(settings(), "api"))).isSubsetOf(read);
	}

	/**
	 * And the realm the API trusts is the realm the admin corner signs into.
	 *
	 * <p>They are two settings in two containers and a disagreement between them is a browser that signs in
	 * successfully and is then refused by the API with a {@code 401} — which reads as a broken token rather
	 * than as two addresses. Written as one substitution of one variable, so this asserts they are the same
	 * text rather than that somebody kept two in step.
	 */
	@Test
	void andTheRealmTheApiTrustsIsTheOneTheAdminCornerSignsInTo() {
		String issuer = settingIn("SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI");

		assertThat(settingIn("MPRELIST_WEB_ISSUER")).isEqualTo(issuer);
		// And the realm in it is the one the export declares, rather than a name a deployment could get wrong.
		assertThat(issuer).endsWith("/realms/mprelist");
		assertThat(Json.of(InfraFiles.textOf(InfraFiles.keycloakRealm())).get("realm").asText()).isEqualTo("mprelist");
	}

	/**
	 * And its example environment names everything it asks for, in both directions.
	 *
	 * <p>The same rule {@link EnvironmentFileTest} keeps for the local stack, and it matters more here: a
	 * variable this file requires and the example does not name is a deployment that stops at the first
	 * {@code up} with nothing to copy the answer from, and a variable the example names and nothing reads is
	 * an operator setting a password that goes nowhere.
	 */
	@Test
	void andItsExampleEnvironmentNamesEverythingItAsksFor() {
		Set<String> required = namesMatching("\\$\\{(MPRELIST_[A-Z0-9_]*)", settings());
		required.addAll(namesMatching("^\\s+(MPRELIST_[A-Z0-9_]*):\\s*$", settings()));
		Set<String> named = namesMatching("^#?\\s*(MPRELIST_[A-Z0-9_]*)=", example());

		assertThat(named).containsAll(required);
		assertThat(named).isSubsetOf(required);
	}

	/**
	 * And nothing in that example is a value anybody could deploy by accident.
	 *
	 * <p>Every line the file ships with a value is an address to edit, and every credential ships empty —
	 * which is what makes compose's own refusal the thing that stops a deployment with the example's
	 * passwords in it, rather than somebody noticing.
	 */
	@Test
	void andNothingInItIsAPasswordAnybodyCouldDeployByAccident() {
		for (String secret : new String[] { "MPRELIST_DB_PASSWORD", "MPRELIST_KEYCLOAK_DB_PASSWORD",
				"MPRELIST_KEYCLOAK_ADMIN", "MPRELIST_KEYCLOAK_ADMIN_PASSWORD", "MPRELIST_EXTENSION_ID" }) {
			assertThat(assignedInTheExample(secret))
					.withFailMessage("infra/production.env.example assigns %s a value. It is required and has no "
							+ "default, so shipping one is shipping a deployment nobody chose.", secret)
					.isEmpty();
		}
		assertThat(example()).doesNotContain("sk_").doesNotContain("rk_").doesNotContain("whsec_");
	}

	/** And the file it is an example of is one git never takes, which is where the whole arrangement rests. */
	@Test
	void andTheFileItIsAnExampleOfIsNeverCommitted() {
		assertThat(InfraFiles.textOf(InfraFiles.gitignore()).lines().map(String::trim))
				.contains("/production.env");
	}

	// --- reading the two files --------------------------------------------------------------------------

	/**
	 * What the file <em>does</em>, which is its text with its prose taken out.
	 *
	 * <p>Every assertion here reads this rather than the file itself, and the reason is that the file is
	 * commented on exactly the subjects it is asserted about: it says in words that it never sets
	 * {@code MPRELIST_SSL_REQUIRED} and that it runs Keycloak rather than {@code start-dev}, and a test
	 * reading the whole text finds both of those sentences and reads them as settings.
	 */
	private static String settings() {
		return InfraFiles.textOf(InfraFiles.productionComposeFile()).lines()
				.map(line -> line.replaceFirst("(^|\\s)#.*$", ""))
				.filter(line -> !line.isBlank())
				.collect(Collectors.joining("\n", "", "\n"));
	}

	private static String example() {
		return InfraFiles.textOf(InfraFiles.productionEnvironmentExample());
	}

	/** One service's own block, from its name to the next one at the same indentation. */
	private static String serviceIn(String compose, String service) {
		Matcher block = Pattern.compile("^  " + service + ":$(.*?)(?=^  \\S|\\Z)",
				Pattern.MULTILINE | Pattern.DOTALL).matcher(compose);
		if (!block.find()) {
			throw new IllegalStateException(InfraFiles.productionComposeFile() + " no longer defines a "
					+ service + " service, which these assertions are about");
		}
		return block.group(1);
	}

	/**
	 * What it sets one entry to, as written rather than as interpolated — read to the end of the line, since
	 * a {@code ${NAME:?why}} carries a sentence and {@link YamlSetting} reads a value with no spaces in it.
	 */
	private static String settingIn(String key) {
		Matcher value = Pattern.compile("^\\s*" + Pattern.quote(key) + ":\\s*(.+?)\\s*$", Pattern.MULTILINE)
				.matcher(settings());
		if (!value.find()) {
			throw new IllegalStateException(InfraFiles.productionComposeFile() + " no longer sets " + key);
		}
		return value.group(1);
	}

	private static Set<String> namesMatching(String pattern, String text) {
		return Pattern.compile(pattern, Pattern.MULTILINE).matcher(text).results()
				.map(name -> name.group(1))
				.collect(Collectors.toCollection(LinkedHashSet::new));
	}

	/** The tag a compose file gives an image, for the one file {@link ComposeFile} does not read. */
	private static String imageIn(String compose, String repository) {
		Matcher image = Pattern.compile("^\\s*image:\\s*(" + Pattern.quote(repository) + ":\\S+)\\s*$",
				Pattern.MULTILINE).matcher(compose);
		if (!image.find()) {
			throw new IllegalStateException(InfraFiles.productionComposeFile() + " no longer names a "
					+ repository + " image");
		}
		return image.group(1);
	}

	/** What the example assigns a variable, or {@code null} where it names it only as a commented line. */
	private static String assignedInTheExample(String name) {
		Matcher line = Pattern.compile("^" + Pattern.quote(name) + "=(.*)$", Pattern.MULTILINE).matcher(example());
		return line.find() ? line.group(1).trim() : null;
	}

}
