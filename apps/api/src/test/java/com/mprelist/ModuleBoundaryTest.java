package com.mprelist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.MatchResult;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.assertj.core.api.SoftAssertions;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

/**
 * The build-time boundary check ADR-0012 makes the point of this module layout: a module reaching into
 * another's internals fails the build rather than being caught in review, or not at all.
 */
class ModuleBoundaryTest {

	private static final ApplicationModules MODULES = ApplicationModules.of(ApiApplication.class);

	/** Named once: three tests are about all of them, and a ninth module should break every one. */
	private static final List<String> EVERY_MODULE = List.of("identity", "catalog", "subscription",
			"enforcement", "display", "admin", "billing", "clientconfig");

	@Test
	void noModuleReachesIntoAnothersInternals() {
		MODULES.verify();
	}

	/**
	 * The check above passes, and a check that passes is indistinguishable from one that has stopped working
	 * until something is written for it to catch — which is not a thing to write on purpose in {@code main}.
	 * This points the same verification at a fixture built to be caught instead: a failure above means the
	 * layout is broken, a failure here means the check is.
	 *
	 * <p>Worth more since #20, not less. There are real inter-module references now — {@code subscription}
	 * reads {@code identity}'s {@code UserProvisioned} and {@code catalog}'s {@code TierCatalog} — so the
	 * check above has something to be right about, and this is what says it would notice one of them reaching
	 * a package deeper.
	 */
	@Test
	void andTheCheckAboveIsWhatWouldCatchOneThatDid() {
		assertThatThrownBy(() -> ApplicationModules.of("fixtures.boundary").verify())
				.hasMessageContaining("BetaService")
				.hasMessageContaining("AlphaInternals");
	}

	/**
	 * A module Modulith does not see is a module it does not check, and an empty package produces no class
	 * file to see. This is what would fail if a package-info lost its {@code @ApplicationModule}.
	 */
	@Test
	void allEightModulesAreVisibleToTheCheck() {
		assertThat(MODULES.stream().map(module -> module.getIdentifier().toString()))
				.containsExactlyInAnyOrderElementsOf(EVERY_MODULE);
	}

	/**
	 * <strong>ADR-0012's tree is the list of what each module lets another see, and until now nothing held it
	 * to the packages.</strong> The check above enforces that {@code internal/} stays private; what it cannot
	 * enforce is whether a type that was made public got written down, and the ADR's own rule — <em>a ticket
	 * that adds to one amends them here</em> — was broken by nine types across five tickets before anybody
	 * noticed, then by four more lists after the amendment that noticed.
	 *
	 * <p>Both corrections were somebody reading carefully. This is what makes the next one a failing build:
	 * a type made public in a module's root package is a decision to publish it, and a decision nobody wrote
	 * down is one taken by whoever happened to write the class.
	 *
	 * <p>Soft, so that four stale lists are four lines of output rather than four runs.
	 */
	@Test
	void andEveryPublicTypeIsWrittenDownInAdr0012() {
		Map<String, String> listed = publicTypesListedInTheAdr();
		SoftAssertions.assertSoftly(each -> EVERY_MODULE.forEach(module -> each
				.assertThat(typeNamesIn(listed.getOrDefault(module, "")))
				.as("ADR-0012's tree for `%s`. A type here that the tree does not name was made public "
						+ "without the decision being written down; a name in the tree that is no longer "
						+ "public is a list describing code that has moved. Amend the tree in "
						+ "docs/adr/0012-backend-modular-monolith.md.", module)
				.isEqualTo(publicTypesIn(module))));
	}

	/**
	 * And the reading above is what would stop working first. It finds a module by the shape
	 * {@code <module>/ public: …} inside the ADR's first fenced block, so a tree that is reformatted — or a
	 * module added to the code and not to it — leaves that check comparing a real package against nothing and
	 * passing. This is the assertion that turns a silent reformat into a failure naming the module it lost.
	 */
	@Test
	void andTheTreeIsStillWrittenTheWayThatCheckReadsIt() {
		assertThat(publicTypesListedInTheAdr().keySet())
				.as("Every module must appear in ADR-0012's tree as `<module>/ public: …`, which is how the "
						+ "check above finds it. A module missing here is one whose list is no longer being "
						+ "compared against anything.")
				.containsExactlyInAnyOrderElementsOf(EVERY_MODULE);
	}

	// --- reading the two sides ---------------------------------------------------------------------------

	/**
	 * What the ADR says, as raw text per module: everything after {@code public:} until the line that opens
	 * the next package. {@code internal/} closes a module's entry by being one, which is also what keeps
	 * {@code billing}'s wrapped route line out of its type list.
	 */
	private static Map<String, String> publicTypesListedInTheAdr() {
		Map<String, String> listed = new LinkedHashMap<>();
		String module = null;
		StringBuilder types = new StringBuilder();
		for (String line : moduleTree().lines().toList()) {
			Matcher opens = OPENS_A_MODULE.matcher(line);
			if (opens.matches()) {
				if (module != null) {
					listed.put(module, types.toString());
				}
				module = opens.group(1);
				types = new StringBuilder(opens.group(2));
			}
			else if (OPENS_A_PACKAGE.matcher(line).find()) {
				if (module != null) {
					listed.put(module, types.toString());
				}
				module = null;
				types = new StringBuilder();
			}
			else if (module != null) {
				types.append(' ').append(line);
			}
		}
		if (module != null) {
			listed.put(module, types.toString());
		}
		return listed;
	}

	/** The first fenced block, which is the tree. */
	private static String moduleTree() {
		String adr = InfraFiles.textOf(InfraFiles.moduleArchitectureAdr());
		int opens = adr.indexOf(FENCE);
		int closes = adr.indexOf(FENCE, opens + FENCE.length());
		if (opens < 0 || closes < 0) {
			throw new IllegalStateException("ADR-0012 has no fenced block, so its module tree cannot be read");
		}
		return adr.substring(opens + FENCE.length(), closes);
	}

	/** Type names only: a route (`/api/me`) is not one, which is how the three route-only modules read empty. */
	private static Set<String> typeNamesIn(String listed) {
		return A_TYPE_NAME.matcher(listed).results().map(MatchResult::group)
				.collect(Collectors.toCollection(TreeSet::new));
	}

	/**
	 * What the code says: every public top-level type in the module's own package, off the compiled main
	 * output rather than the source tree, so this is what another module can actually reach. Nested types are
	 * skipped — they are reached through the one that declares them, which is the name the tree carries.
	 */
	private static Set<String> publicTypesIn(String module) {
		Path packaged = mainClasses().resolve("com/mprelist").resolve(module);
		if (!Files.isDirectory(packaged)) {
			return Set.of();
		}
		try (Stream<Path> files = Files.list(packaged)) {
			Set<String> names = new TreeSet<>();
			for (Path file : files.toList()) {
				String named = file.getFileName().toString();
				if (!named.endsWith(".class") || named.contains("$") || named.equals("package-info.class")) {
					continue;
				}
				Class<?> type = Class.forName("com.mprelist." + module + "."
						+ named.substring(0, named.length() - ".class".length()));
				if (Modifier.isPublic(type.getModifiers())) {
					names.add(type.getSimpleName());
				}
			}
			return names;
		}
		catch (Exception unreadable) {
			throw new IllegalStateException("Cannot read the compiled package for `" + module + "`", unreadable);
		}
	}

	private static Path mainClasses() {
		try {
			return Path.of(ApiApplication.class.getProtectionDomain().getCodeSource().getLocation().toURI());
		}
		catch (Exception unreachable) {
			throw new IllegalStateException("Cannot find this application's own compiled output", unreachable);
		}
	}

	private static final String FENCE = "```";

	/** `├── catalog/       public: TierId, …` — the line that opens a module's list. */
	private static final Pattern OPENS_A_MODULE = Pattern.compile("^\\W*(\\w+)/\\s+public:\\s*(.*)$");

	/** Any `<name>/` line, which is what closes the list above — `internal/` being the one that always does. */
	private static final Pattern OPENS_A_PACKAGE = Pattern.compile("^\\W*\\w+/");

	private static final Pattern A_TYPE_NAME = Pattern.compile("\\b[A-Z][A-Za-z0-9]*\\b");
}
