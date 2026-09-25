package com.mprelist.billing.internal;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.mprelist.enforcement.ReasonCode;
import com.mprelist.identity.UserRef;

/**
 * {@code POST /api/plan-switch/preview} and {@code POST /api/plan-switch} — a <strong>Plan switch</strong>,
 * priced and then made (T85, ADR-0036).
 *
 * <p><strong>Called by the site</strong>, which asks for the preview when a subscriber presses
 * <em>Overstappen</em>, shows it in a confirmation dialog, and switches when they confirm. The popup's door
 * to the same act is the Customer Portal (T83).
 *
 * <p>The body is {@link StartCheckout}'s — a tier code and a Rhythm — and so are the refusals: {@code 404} when
 * nothing is on sale under them, {@code 503} when Stripe could not be asked, both with an empty body. The one
 * denial is {@code 409 NOT_PAYING}, T83's {@code ALREADY_PAYING} the other way round: nothing to switch, so
 * Checkout is theirs.
 *
 * <p>A switch answers {@code 200} with {@code {"confirmAt": null}} when it is done, or with the hosted invoice
 * page when the payer has to confirm the charge — 3-D Secure — before anything moves.
 */
@RestController
class StartPlanSwitch {

	StartPlanSwitch(SwitchPlans switches) {
		this.switches = switches;
	}

	@PostMapping(path = PREVIEW, consumes = MediaType.APPLICATION_JSON_VALUE)
	ResponseEntity<?> preview(UserRef who, @RequestBody SwitchRequest request) {
		if (!readable(request)) {
			return ResponseEntity.badRequest().build();
		}
		return answer(this.switches.preview(who, request.tierCode().strip(), request.interval().strip()));
	}

	@PostMapping(path = PATH, consumes = MediaType.APPLICATION_JSON_VALUE)
	ResponseEntity<?> apply(UserRef who, @RequestBody SwitchRequest request) {
		if (!readable(request)) {
			return ResponseEntity.badRequest().build();
		}
		return answer(this.switches.apply(who, request.tierCode().strip(), request.interval().strip()));
	}

	private static boolean readable(SwitchRequest request) {
		return request != null && request.tierCode() != null && !request.tierCode().isBlank()
				&& request.interval() != null && !request.interval().isBlank();
	}

	private static ResponseEntity<?> answer(PlanSwitch outcome) {
		return switch (outcome) {
			case PlanSwitch.Previewed previewed ->
				ResponseEntity.ok(new SwitchPreview(previewed.amount(), previewed.currency()));
			case PlanSwitch.Switched ignored -> ResponseEntity.ok(new SwitchMade(null));
			case PlanSwitch.ConfirmPayment confirm -> ResponseEntity.ok(new SwitchMade(confirm.url()));
			case PlanSwitch.NotPaying ignored -> ResponseEntity.status(ReasonCode.NOT_PAYING.status())
					.body(new Denied(ReasonCode.NOT_PAYING));
			case PlanSwitch.NotForSale ignored -> ResponseEntity.notFound().build();
			case PlanSwitch.Unavailable ignored -> ResponseEntity.status(503).build();
		};
	}

	/** Which plan, at which rhythm — {@link StartCheckout.CheckoutRequest}'s shape, for the same reasons. */
	record SwitchRequest(String tierCode, String interval) {
	}

	/**
	 * What the switch would invoice now. Negative is a credit, and the client says so rather than showing a
	 * minus sign.
	 */
	record SwitchPreview(long amount, String currency) {
	}

	/**
	 * {@code confirmAt} is {@code null} when the switch is made, and the invoice's hosted page when the payer
	 * has to confirm the charge first. Sent rather than omitted: "nothing to confirm" is an answer.
	 */
	record SwitchMade(String confirmAt) {
	}

	/** {@code {"reason":"NOT_PAYING"}}, as {@link StartCheckout.Denied} is for its code. */
	record Denied(ReasonCode reason) {
	}

	private final SwitchPlans switches;

	static final String PATH = "/api/plan-switch";

	static final String PREVIEW = PATH + "/preview";

}

/** The {@code 400} for a body that is not JSON of the shape above, empty like its counterpart's. */
@RestControllerAdvice(assignableTypes = StartPlanSwitch.class)
class UnreadablePlanSwitchRequests {

	@ExceptionHandler(HttpMessageNotReadableException.class)
	ResponseEntity<Void> theRequestCouldNotBeRead(HttpMessageNotReadableException unreadable) {
		return ResponseEntity.badRequest().build();
	}

}
