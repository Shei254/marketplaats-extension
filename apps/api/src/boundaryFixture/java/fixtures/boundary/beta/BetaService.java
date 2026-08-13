package fixtures.boundary.beta;

import fixtures.boundary.alpha.internal.AlphaInternals;

/**
 * Module {@code beta}, reaching into {@code alpha}'s internals — the violation
 * {@code ModuleBoundaryTest} asserts is caught. Nothing here is ever run; it exists to be analysed.
 */
public class BetaService {

	private final AlphaInternals alpha = new AlphaInternals();

	public String leak() {
		return alpha.secret();
	}
}
