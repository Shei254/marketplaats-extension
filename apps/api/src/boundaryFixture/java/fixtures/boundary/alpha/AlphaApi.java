package fixtures.boundary.alpha;

/**
 * The exposed type of module {@code alpha} — what a well-behaved module would use. Present so the fixture
 * fails for the reason under test (reaching past this into {@code internal}) rather than for want of any
 * public API at all.
 */
public class AlphaApi {

	public String greet() {
		return "alpha";
	}
}
