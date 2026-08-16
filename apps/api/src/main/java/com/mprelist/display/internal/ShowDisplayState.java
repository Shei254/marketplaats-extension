package com.mprelist.display.internal;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.mprelist.identity.UserRef;

/**
 * {@code GET /api/me} — what the signed-in caller has, for a client to render (#26,
 * {@code docs/enforcement-contract.md}).
 *
 * <p>{@link UserRef} rather than {@code CurrentUser}, and this is the route ADR-0014's provisioning was
 * waiting for: asking for one creates the {@code app_user} and its default-tier subscription on first sight
 * of a subject (#20), and this is the call both clients make immediately after signing in. So a brand-new
 * user's first {@code /api/me} answers with the plan it has just provisioned rather than failing on an
 * account nobody has created — which is what makes "no subscription" unreachable for every later reader.
 *
 * <p><strong>One status and no denials.</strong> Every authenticated caller has a subscription, so there is
 * nothing here to refuse: a lapsed payer and an exhausted free user are both <em>shown</em> their state, and
 * being turned away for it is the gate's job on the call that grants something. The only answer other than
 * {@code 200} is the {@code 401} the filter chain writes before this method is reached (#19).
 *
 * <p>No {@code consumes} beside the mapping, unlike the two {@code POST} routes: a {@code GET} carries no
 * body for this API to fail to read.
 */
@RestController
class ShowDisplayState {

	ShowDisplayState(DisplayStates states) {
		this.states = states;
	}

	@GetMapping("/api/me")
	DisplayState me(UserRef caller) {
		return this.states.forCaller(caller);
	}

	private final DisplayStates states;

}
