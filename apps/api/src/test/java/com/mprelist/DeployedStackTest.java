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
 * compose files, because that difference <em>is</em> the ticket: the same four pieces of software, plus a
 * proxy in front of them (T56, #87), run with none of the settings that make the local stack convenient.
 * Every one of these has a failure mode that is silent from the deployed side — a Keycloak still in
 * development mode serves sign-ins perfectly well, and a realm imported from {@code ./keycloak} gives a
 * stranger the account called {@code dev} with a password this repository publishes.
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
	 * And it builds nothing: both of our own images are pulled by tag.
	 *
	 * <p>The host is 1 vCPU and 4 GB and {@code apps/api/Dockerfile} compiles this repository inside itself —
	 * a third JVM wanting a gigabyte, on one shared core, competing with the two processes it is replacing
	 * (ADR-0023). A {@code build:} that came back would not fail; it would make every deploy a thirty-minute
	 * outage that looks like slowness.
	 */
	@Test
	void andBuildsNeitherOfOurOwnImagesOnTheHost() {
		assertThat(settings())
				.withFailMessage("infra/docker-compose.prod.yml builds an image again. The deployed host "
						+ "compiles nothing (ADR-0023): CI pushes both to GHCR and this file names tags.")
				.doesNotContain("build:");

		for (String service : new String[] { "api", "web" }) {
			assertThat(serviceIn(settings(), service))
					.contains("${MPRELIST_IMAGE_REPOSITORY:?")
					.contains("${MPRELIST_IMAGE_TAG:?");
		}
	}

	/**
	 * And nothing but the proxy binds a port on that host.
	 *
	 * <p>This replaced an interim that asked an operator to write {@code 127.0.0.1:8080}-style values into
	 * three variables, and the reason it replaced it is the mistake that arrangement invited: a port set to a
	 * public value by somebody who did not know why it was loopback. There is now no such variable to set.
	 *
	 * <p>Postgres is first in the list because it is the one mistake here a deployment cannot recover from by
	 * restarting — what leaks is every subscriber's row and, given the password, everything else too. Keycloak
	 * is the quietest: a published port is a plain-HTTP one, which its own {@code sslRequired: external} then
	 * refuses, and that reads as a broken deployment rather than as a setting working.
	 */
	@Test
	void andPublishesNoPortExceptTheProxysOwn() {
		for (String service : new String[] { "postgres", "keycloak", "api", "web" }) {
			assertThat(serviceIn(settings(), service))
					.withFailMessage("the %s service publishes a port. Only caddy may (ADR-0023).", service)
					.doesNotContain("ports:");
		}
		assertThat(serviceIn(settings(), "caddy")).contains("80:80").contains("443:443");
	}

	/**
	 * And every service is given a memory limit, inside a budget that leaves the host room to breathe.
	 *
	 * <p>Unbounded, each JVM sizes its heap against the whole host: Keycloak's image runs a high
	 * {@code MaxRAMPercentage} and a Spring Boot container defaults to ≈25%, which on 4 GB can total more
	 * than there is. What that looks like is not an error — it is the OOM killer taking the largest resident
	 * process and {@code restart: unless-stopped} bringing it back, forever, with nothing in any log that
	 * names a cause.
	 *
	 * <p>The ceiling is asserted rather than the individual numbers, because the numbers are a guess that
	 * predates any traffic and are meant to move. What must not move is their sum: the OS, dockerd, the page
	 * cache and a concurrent {@code pg_dump} live in what is left.
	 */
	@Test
	void andGivesEveryServiceAMemoryLimitWithinTheHostsBudget() {
		int total = 0;
		for (String service : new String[] { "postgres", "keycloak", "api", "web", "caddy" }) {
			Matcher limit = Pattern.compile("^\\s*mem_limit:\\s*(\\d+)([mg])\\s*$", Pattern.MULTILINE)
					.matcher(serviceIn(settings(), service));
			assertThat(limit.find())
					.withFailMessage("the %s service has no mem_limit. On a 4 GB host that is not a missing "
							+ "optimisation, it is an OOM-kill restart loop with no error in it.", service)
					.isTrue();
			total += Integer.parseInt(limit.group(1)) * ("g".equals(limit.group(2)) ? 1024 : 1);
		}

		assertThat(total)
				.withFailMessage("the five limits total %d MB. The host has 4096, and what is left over is "
						+ "the OS, dockerd, the page cache and whatever a pg_dump needs.", total)
				.isLessThanOrEqualTo(2816);
	}

	/**
	 * And the API is told what share of that limit its heap may be, which {@code mem_limit} alone does not say.
	 *
	 * <p>This is the one setting here that fails in the direction of looking correct. A modern JVM reads its
	 * cgroup, so the limit above would bound it properly — to a 256 MB heap, a quarter of its allowance,
	 * because ≈25% is the default. The stack would be exactly as bounded as intended and this application
	 * would collect garbage far harder than it should, presenting as latency rather than as a crash.
	 */
	@Test
	void andTellsTheApiWhatShareOfItItsHeapMayBe() {
		assertThat(serviceIn(settings(), "api")).contains("MaxRAMPercentage");
	}

	/**
	 * And the proxy keeps its certificates in a named volume, which is the silent one.
	 *
	 * <p>The certificate <em>and the ACME account key</em> live in {@code /data}. Without the volume every
	 * {@code up} starts Caddy with nothing to renew, so it requests a <em>new</em> certificate for the
	 * identical name set — Let's Encrypt's duplicate limit, 5 per 7 days, refilling one every 34 hours. It is
	 * not renewals that spend that (six a year); it is every deploy. And nothing about it is visible until
	 * the sixth one in a week is refused.
	 */
	@Test
	void andKeepsTheProxysCertificatesWhereARestartCannotLoseThem() {
		assertThat(serviceIn(settings(), "caddy")).contains("caddy_data:/data");
		assertThat(settings()).containsPattern("(?m)^volumes:(.|\\n)*^  caddy_data:");
	}

	/**
	 * And the proxy asks for nothing this file does not hand it.
	 *
	 * <p>A Caddyfile reads {@code {$NAME}} and substitutes the empty string for a variable that is not in its
	 * environment. An empty site address is a Caddyfile that fails to parse — loudly, which is fine — but an
	 * empty {@code redir} target or ACME directory is a proxy that starts and is wrong, and the two files
	 * that have to agree about these names are edited months apart.
	 */
	@Test
	void andTheProxyAsksForNoVariableThisFileDoesNotGiveIt() {
		Set<String> given = namesMatching("^\\s+(MPRELIST_[A-Z0-9_]*):", serviceIn(settings(), "caddy"));

		assertThat(namesMatching("\\{\\$(MPRELIST_[A-Z0-9_]*)}", InfraFiles.textOf(InfraFiles.caddyfile())))
				.isSubsetOf(given);
	}

	/**
	 * And it <em>redirects</em> the admin hostname's root, rather than rewriting it.
	 *
	 * <p>ADR-0017's "{@code admin.} serves {@code /admin}" was always a claim about a proxy:
	 * {@code apps/web/src/main.tsx} chooses its surface with {@code isAdminPath(location.pathname)} and knows
	 * nothing about the host, deliberately, since one image runs anywhere. Untouched, {@code admin.<domain>}
	 * is the marketing site's not-found page.
	 *
	 * <p><strong>ADR-0023 specifies a {@code rewrite} and a rewrite cannot do it</strong>, which is the whole
	 * reason this assertion names the directive instead of the outcome. A rewrite is internal: it changes
	 * which path the proxy asks nginx for and leaves the browser's address alone — and nginx answers every
	 * path with the same {@code index.html} anyway, so the bundle boots at {@code location.pathname === "/"}
	 * and renders the public site. Nothing about that looks like a failure from either side of the proxy.
	 * The ADR carries the correction; this is what stops the next person from applying its original sentence.
	 */
	@Test
	void andRedirectsTheAdminHostnamesRootRatherThanRewritingIt() {
		String caddyfile = InfraFiles.textOf(InfraFiles.caddyfile());

		assertThat(caddyfile)
				.withFailMessage("the admin hostname's root is not redirected to /admin. A `rewrite` is not a "
						+ "substitute: it never reaches the browser, and the surface is chosen from "
						+ "location.pathname. See ADR-0023's correction of 2026-09-02.")
				.containsPattern("redir\\s+/\\s+/admin");
		assertThat(caddyfile).doesNotContainPattern("rewrite\\s+/\\s+/admin");
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
	 * And the API answers the admin corner's browser, which is now a second origin rather than the site's.
	 *
	 * <p>{@code admin.<domain>} is a hostname of its own (ADR-0017, and {@code caddy} is what redirects its
	 * root to {@code /admin}), and a hostname is an origin — so the screen that calls this API calls it from
	 * somewhere {@code MPRELIST_WEB_BASE_URL} does not name. <strong>This exact mistake has been made twice
	 * already</strong>, which {@code CrossOriginCallers} says in its own words: T53 shipped the {@code PUT} routes
	 * and T54 the screen, and neither added what CORS needed. It is invisible from this side — a browser
	 * refuses before the request is sent and this application logs nothing — and a deployment would have a
	 * working payment flow beside an admin corner that answers nothing.
	 */
	@Test
	void andAnswersTheAdminCornersBrowserAsWellAsTheSites() {
		assertThat(settingIn("MPRELIST_WEB_ORIGIN"))
				.contains("${MPRELIST_WEB_BASE_URL")
				.contains("${MPRELIST_ADMIN_BASE_URL");
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
