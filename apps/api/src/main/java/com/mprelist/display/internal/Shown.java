package com.mprelist.display.internal;

import com.mprelist.enforcement.ReasonCode;

/**
 * What {@code GET /api/me} has to say about the caller: their plan, or the one reason there is not one (T77,
 * <a href="../../../../../../../../docs/adr/0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md">ADR-0032</a>).
 *
 * <p>Sealed, for {@code Verdict}'s reason one module over: the route below cannot forget a case, and a third
 * answer would have to be added here — where somebody has to decide what a client does about it — rather than
 * appearing as a status invented at a return statement.
 *
 * <p><strong>This route had no refusals at all until now, and that was a documented property rather than an
 * accident.</strong> Every authenticated caller has a subscription, so a lapsed payer and an exhausted free
 * user were both <em>shown</em> their state and being turned away was the gate's job on the call that grants
 * something. What changed is that a subscription may name no tier, and then there is no name, no grant and no
 * {@code resetAt} to render — every field of {@link DisplayState} but the status would have to be invented.
 */
sealed interface Shown {

	/** The snapshot, for a caller whose subscription names a tier — which is everybody, nearly always. */
	record Plan(DisplayState state) implements Shown {
	}

	/**
	 * The caller's tier was deleted and there was no default to move them to, so there is nothing to show.
	 *
	 * <p><strong>Carrying a {@link ReasonCode} rather than the word</strong>, because this is the second
	 * route in the application to deny with one and a literal here would be a string nothing compares to
	 * anything — {@code packages/contracts} holds its own list to that enum, and it is the only thing that
	 * would notice the two drifting apart.
	 *
	 * <p><strong>And it is answered here rather than only at the gate, which is the half that makes the code
	 * worth its contract change.</strong> {@code display-state.ts} maps every non-{@code 200} to
	 * {@code unavailable} bar two — {@code 401} is signed-out, {@code 426} is outdated — so a denial sent only
	 * to {@code /authorize} would be read by nobody: the popup says "unavailable, retry" first, and the user
	 * never presses the button that would have been answered honestly.
	 */
	record NoTier() implements Shown {

		ReasonCode reason() {
			return ReasonCode.NO_TIER;
		}

	}

}
