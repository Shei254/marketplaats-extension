package com.mprelist.display.internal;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.mprelist.enforcement.ReasonCode;
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
 * <p><strong>One denial, and it took T77 to produce one.</strong> Every authenticated caller has a
 * subscription row, so nearly nothing here is refusable: a lapsed payer and an exhausted free user are both
 * <em>shown</em> their state, and being turned away for it is the gate's job on the call that grants
 * something. The exception is a subscription that names no tier
 * (<a href="../../../../../../../../docs/adr/0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md">ADR-0032</a>),
 * where there is no plan to read a name, a grant or a {@code resetAt} out of — see {@link Shown}. Beside it,
 * the {@code 401} the filter chain writes before this method is reached (#19) and the {@code 426} an outdated
 * build gets (T43, #52) are the only other answers.
 *
 * <p>No {@code consumes} beside the mapping, unlike the two {@code POST} routes: a {@code GET} carries no
 * body for this API to fail to read.
 */
@RestController
class ShowDisplayState {

	ShowDisplayState(DisplayStates states) {
		this.states = states;
	}

	/**
	 * {@code ResponseEntity<?>} rather than the record, which is the shape the one denial costs. Every
	 * other route in this application that answers two ways does the same, and the alternative — a
	 * {@link DisplayState} with its four tier-shaped fields sent as nulls and a status beside them — is a body
	 * a client would render as a plan with holes in it.
	 */
	@GetMapping("/api/me")
	ResponseEntity<?> me(UserRef caller) {
		return switch (this.states.forCaller(caller)) {
			case Shown.Plan shown -> ResponseEntity.ok(shown.state());
			// The denial shape `docs/enforcement-contract.md` fixes: the code, and whatever that code adds,
			// which here is nothing. The status is the code's own, so that "NO_TIER is a 403" is stated once
			// — on the enum, beside the four the gate sends.
			case Shown.NoTier denied -> ResponseEntity.status(denied.reason().status())
					.body(new Denied(denied.reason()));
		};
	}

	/**
	 * The body of this route's one denial — the shape every denial in the contract has, which is a typed code
	 * plus whatever that code carries.
	 *
	 * <p>Its own record rather than {@code enforcement}'s {@code Verdict.Refused}, which is that module's
	 * answer about a relist and carries two fields this can never have — and no {@code @JsonInclude} either,
	 * which that one needs because a code that adds nothing must not send {@code "resetAt": null}. One field
	 * that is never null has nothing to exclude, and an annotation no test could tell the difference about is
	 * one this repository deletes.
	 *
	 * <p>The <em>code</em> is shared and that is the part that matters: {@link ReasonCode} is public precisely
	 * so that this is not a second spelling of a word.
	 */
	record Denied(ReasonCode reason) {
	}

	private final DisplayStates states;

}
