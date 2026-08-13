package fixtures.boundary.alpha.internal;

/**
 * Inside module {@code alpha}. Public to the compiler, non-exposed to Spring Modulith — a sub-package of a
 * module is internal to it, which is the whole point of the ADR-0012 layout.
 */
public class AlphaInternals {

	public String secret() {
		return "alpha's business";
	}
}
