package com.mprelist.identity.internal;

import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Which build of which client is calling (T43, #52).
 *
 * <p>It arrives as one header — {@code X-Mprelist-Client: extension/0.0.1} — because the two facts travel
 * together and are useless apart: a version with no surface cannot be compared against anything, and this API
 * has more than one client.
 *
 * <p><strong>Versions are Chrome's, not semver's.</strong> A Chrome extension version is one to four
 * dot-separated integers and has no pre-release or build metadata, so comparison is component-wise on numbers
 * with a missing component read as zero — which is Chrome's own rule and makes {@code 1.2} and {@code 1.2.0}
 * the same release rather than two. Borrowing a semver library to parse something that is not semver would be
 * borrowing its opinions about {@code -beta} too.
 *
 * <p><strong>This is identification, not authentication.</strong> Nothing here is a security boundary: the
 * header is written by the client, and a client that wanted to lie about its version could. What it is for is
 * the release cadence — extensions ship in days through a store review, this API ships in minutes — so the
 * API needs a way to say "the build you are running must not do this any more" and a way to be told which
 * build that is.
 */
record ClientRelease(String surface, String version) {

	/**
	 * The header as a release, or nothing where it is absent or not shaped like one.
	 *
	 * <p>Absent and malformed are the same answer on purpose, and the answer is not a refusal: {@code apps/web}
	 * does not send one yet, {@code curl} never will, and every extension built before this ticket cannot.
	 * Refusing what does not identify itself would turn a diagnostic into a gate on traffic it was never meant
	 * to judge — see {@code RefuseOutdatedClients} for what is done with a release that *is* named.
	 */
	static Optional<ClientRelease> in(String header) {
		if (header == null) {
			return Optional.empty();
		}
		int slash = header.indexOf('/');
		if (slash <= 0 || slash == header.length() - 1) {
			return Optional.empty();
		}
		String surface = header.substring(0, slash).strip();
		String version = header.substring(slash + 1).strip();
		if (surface.isEmpty() || !VERSION.matcher(version).matches()) {
			return Optional.empty();
		}
		return Optional.of(new ClientRelease(surface, version));
	}

	/**
	 * Whether this release is behind the one named.
	 *
	 * @param minimum the oldest release still served, as configured. A minimum that is not a version at all is
	 * read as {@code 0}, which serves everybody — the safe direction for a setting nobody meant to set, since
	 * the alternative is an API that turns every client away because somebody typed a word in a YAML file
	 */
	boolean olderThan(String minimum) {
		int[] mine = numbersIn(this.version);
		int[] theirs = numbersIn(minimum);
		for (int at = 0; at < Math.max(mine.length, theirs.length); at++) {
			int difference = Integer.compare(componentAt(mine, at), componentAt(theirs, at));
			if (difference != 0) {
				return difference < 0;
			}
		}
		return false;
	}

	private static int[] numbersIn(String version) {
		if (version == null || !VERSION.matcher(version.strip()).matches()) {
			return new int[] { 0 };
		}
		String[] parts = version.strip().split("\\.");
		int[] numbers = new int[parts.length];
		for (int at = 0; at < parts.length; at++) {
			numbers[at] = Integer.parseInt(parts[at]);
		}
		return numbers;
	}

	/** A component nobody wrote is a zero, so {@code 1.2} and {@code 1.2.0} are one release. */
	private static int componentAt(int[] numbers, int index) {
		return index < numbers.length ? numbers[index] : 0;
	}

	/** Chrome's own shape: one to four dot-separated integers, each of them small. */
	private static final Pattern VERSION = Pattern.compile("\\d{1,5}(\\.\\d{1,5}){0,3}");

}
