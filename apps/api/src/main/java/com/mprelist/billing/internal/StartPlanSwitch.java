package com.mprelist.billing.internal;

import java.time.OffsetDateTime;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.mprelist.enforcement.ReasonCode;
import com.mprelist.identity.UserRef;

/**
 * {@code POST /api/plan-switch/preview} and {@code POST /api/plan-switch} — a <strong>Plan switch</strong>,
 * priced and then made (T85, ADR-0036) — and {@code POST} / {@code DELETE /api/plan-switch/scheduled}, the
 * <strong>Scheduled switch</strong> made and undone (T90, ADR-0042).
 *
 * <p><strong>Called by the site and the popup</strong>, which ask for the preview when a subscriber presses
 * <em>Overstappen</em>, show it beside the choice of <em>Nu</em> or <em>Op {date}</em>, and switch or schedule
 * when they confirm.
 *
 * <p>The body is {@link StartCheckout}'s — a tier code and a Rhythm — and so are the refusals: {@code 404} when
 * nothing is on sale under them, {@code 503} when Stripe could not be asked, both with an empty body. The one
 * denials are {@code 409 NOT_PAYING}, T83's {@code ALREADY_PAYING} the other way round: nothing to switch, so
 * Checkout is theirs; and {@code 409 OPEN_INVOICE} during Dunning, on all four.
 *
 * <p>A switch answers {@code 200} with {@code {"confirmAt": null}} when it is done, or with the hosted invoice
 * page when the payer has to confirm the charge — 3-D Secure — before anything moves. A Scheduled switch
 * answers {@code 200} with {@code {"at": …}}, the day it takes over, or {@code null} where choosing the Price
 * they already pay only dropped what was pending. Undo answers {@code 204}, pending or not.
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

	@PostMapping(path = SCHEDULED, consumes = MediaType.APPLICATION_JSON_VALUE)
	ResponseEntity<?> schedule(UserRef who, @RequestBody SwitchRequest request) {
		if (!readable(request)) {
			return ResponseEntity.badRequest().build();
		}
		PlanSwitch outcome = this.switches.schedule(who, request.tierCode().strip(), request.interval().strip());
		return outcome instanceof PlanSwitch.Switched ? ResponseEntity.ok(new SwitchScheduled(null))
				: answer(outcome);
	}

	@DeleteMapping(SCHEDULED)
	ResponseEntity<?> undo(UserRef who) {
		PlanSwitch outcome = this.switches.undo(who);
		return outcome instanceof PlanSwitch.Switched ? ResponseEntity.noContent().build() : answer(outcome);
	}

	private static boolean readable(SwitchRequest request) {
		return request != null && request.tierCode() != null && !request.tierCode().isBlank()
				&& request.interval() != null && !request.interval().isBlank();
	}

	private static ResponseEntity<?> answer(PlanSwitch outcome) {
		return switch (outcome) {
			case PlanSwitch.Previewed previewed ->
				ResponseEntity.ok(new SwitchPreview(previewed.amount(), previewed.currency(), previewed.renewsAt()));
			case PlanSwitch.Switched ignored -> ResponseEntity.ok(new SwitchMade(null));
			case PlanSwitch.ConfirmPayment confirm -> ResponseEntity.ok(new SwitchMade(confirm.url()));
			case PlanSwitch.Scheduled scheduled -> ResponseEntity.ok(new SwitchScheduled(scheduled.at()));
			case PlanSwitch.InvoiceOpen ignored -> ResponseEntity.status(ReasonCode.OPEN_INVOICE.status())
					.body(new Denied(ReasonCode.OPEN_INVOICE));
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
	 * What the switch would invoice now, and when a Scheduled switch would take over instead (T90): the end of
	 * Stripe's period, which for an annual payer is not the monthly {@code resetAt}.
	 */
	record SwitchPreview(long amount, String currency, OffsetDateTime renewsAt) {
	}

	/**
	 * {@code confirmAt} is {@code null} when the switch is made, and the invoice's hosted page when the payer
	 * has to confirm the charge first. Sent rather than omitted: "nothing to confirm" is an answer.
	 */
	record SwitchMade(String confirmAt) {
	}

	/**
	 * When the chosen Price takes over. Sent as {@code null} where nothing was scheduled because the Price
	 * chosen is the one they pay — the {@link PlanSwitch.Switched} answer on this route.
	 */
	record SwitchScheduled(OffsetDateTime at) {
	}

	/** {@code {"reason":"NOT_PAYING"}} or {@code {"reason":"OPEN_INVOICE"}}, as {@link StartCheckout.Denied} is. */
	record Denied(ReasonCode reason) {
	}

	private final SwitchPlans switches;

	static final String PATH = "/api/plan-switch";

	static final String PREVIEW = PATH + "/preview";

	static final String SCHEDULED = PATH + "/scheduled";

}

/** The {@code 400} for a body that is not JSON of the shape above, empty like its counterpart's. */
@RestControllerAdvice(assignableTypes = StartPlanSwitch.class)
class UnreadablePlanSwitchRequests {

	@ExceptionHandler(HttpMessageNotReadableException.class)
	ResponseEntity<Void> theRequestCouldNotBeRead(HttpMessageNotReadableException unreadable) {
		return ResponseEntity.badRequest().build();
	}

}
