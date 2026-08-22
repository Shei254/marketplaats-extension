package com.mprelist.admin.internal;

import java.util.Map;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.mprelist.billing.NewPlanInStripe;
import com.mprelist.billing.PlanCreation;
import com.mprelist.billing.SellableCurrencies;
import com.mprelist.billing.StripeAccountFacts;
import com.mprelist.billing.StripePlans;
import com.mprelist.catalog.PriceAdoptions;
import com.mprelist.catalog.TaggedPrice;
import com.mprelist.catalog.TierEdit;
import com.mprelist.catalog.TierEdited;
import com.mprelist.catalog.TierEdits;

/**
 * {@code POST /api/admin/plans} — creating a plan without leaving this screen, and
 * {@code GET /api/admin/currencies}, which is what makes the form's currency list something Stripe said
 * rather than something we typed.
 *
 * <p><strong>This amends ADR-0019, and only in the direction that decision left open.</strong> That ADR chose
 * "Stripe is where a plan is created" over a form here, on the grounds that Stripe Prices are immutable and
 * "a form field labelled amount would be lying about what editing it does". That argument is about
 * <em>editing</em>, and it still stands: nothing here or on {@code AdministerTiers} lets an amount be changed.
 * Writing one once, into the system that owns it, is a different act — and repricing is still done in Stripe,
 * where creating a new tagged Price repoints the tier through the sync exactly as it always has.
 *
 * <p><strong>It writes no row itself.</strong> That is what keeps the amendment small: the sequence below is
 * three calls, and the last two are the ones the webhook and the edit form already make.
 *
 * <ol>
 * <li>{@code billing} creates a Product and a Price in Stripe, tagged {@code metadata.tier_code}.
 * <li>{@link PriceAdoptions#adopt} makes the draft row — the same call {@code ReceiveStripeEvents} makes.
 * <li>{@link TierEdits#apply} sets the quota, the flags and whether it is on sale — the same call
 * {@code PUT /api/admin/tiers/{code}} makes.
 * </ol>
 *
 * <p>The {@code price.created} Stripe delivers moments later then finds the row already right, and is the
 * no-op {@link PriceAdoptions} was always documented to be. So there is still exactly one writer of the
 * {@code tier} table's Stripe columns, and the webhook is untouched.
 *
 * <p><strong>Why the failure body is not empty here.</strong> Everywhere else in this API a {@code 4xx} that
 * is not a denial carries nothing, because the status is the whole of the message. Stripe's refusals are not
 * like that — "amount must be at least 50 cents for usd", "this currency is not supported for your account" —
 * and the text is the only thing that tells an operator what to change. So this one route answers a
 * {@code problem}, named deliberately unlike the gate's {@code reason} so that no client can confuse a
 * sentence for an operator with a denial code about a user.
 */
@RestController
class CreatePlans {

	CreatePlans(StripePlans stripe, PriceAdoptions adoptions, TierEdits catalog, StripeAccountFacts account) {
		this.stripe = stripe;
		this.adoptions = adoptions;
		this.catalog = catalog;
		this.account = account;
	}

	/**
	 * What the account can price in, so the form offers what Stripe will take.
	 *
	 * <p>{@code 503} rather than a guess when Stripe cannot be asked: a hardcoded list would offer currencies
	 * this account cannot settle in, and the plan that resulted would render a card and fail at Checkout.
	 */
	@GetMapping(path = CURRENCIES)
	ResponseEntity<SellableCurrencies> currencies() {
		return this.account.sellableCurrencies()
				.map(ResponseEntity::ok)
				.orElseGet(() -> ResponseEntity.status(503).build());
	}

	@PostMapping(path = PLANS, consumes = MediaType.APPLICATION_JSON_VALUE)
	ResponseEntity<?> create(@RequestBody NewPlanRequest request) {
		NewPlanInStripe plan;
		TierEdit grant;
		try {
			plan = request.asPlan();
			grant = request.asGrant();
		}
		catch (IllegalArgumentException unusable) {
			return ResponseEntity.badRequest().build();
		}

		// A code the catalog already holds is refused rather than adopted, and this is the check that makes
		// "create" mean create. Without it the adopt below would repoint an existing tier's Price — the
		// upsert's ordinary behaviour, correct for a webhook and quite wrong for a button labelled New plan:
		// every current subscriber would keep paying the old amount while the tier advertised the new one.
		if (this.catalog.everyTier().stream().anyMatch(tier -> tier.tier().code().equals(plan.tierCode()))) {
			return ResponseEntity.status(409).build();
		}

		// One call, switched on. An earlier draft asked Stripe again on the refusal path, which is a second
		// round trip to be told the same thing — and, with a repeated idempotency key, a replay of it.
		PlanCreation made = this.stripe.create(plan, idempotencyKeyFor(request));
		if (made instanceof PlanCreation.Refused refused) {
			return ResponseEntity.status(422).body(new Problem(refused.because()));
		}
		PlanCreation.Created created = (PlanCreation.Created) made;

		// The webhook's own call, and then the edit form's. Nothing here writes a row of its own.
		this.adoptions.adopt(new TaggedPrice(created.tierCode(), created.stripePriceId(), created.name()));
		return switch (this.catalog.apply(plan.tierCode(), grant)) {
			case TierEdited.Applied applied ->
				ResponseEntity.status(201).body(AdministerTiers.asAdminTier(applied.tier()));
			// Both unreachable: the adopt above has just written the row, and wrote a price id with it.
			// Reported rather than swallowed, because unreachable is a claim and this is where it would fail.
			case TierEdited.NoSuchTier ignored -> ResponseEntity.status(500).build();
			case TierEdited.NothingToChargeAgainst ignored -> ResponseEntity.status(500).build();
		};
	}

	/**
	 * What makes a double-submitted form one plan rather than two.
	 *
	 * <p>Derived from what was asked for rather than from a clock or a random value, which is the only version
	 * that works: Stripe replays the first answer for a repeated key, so two clicks on the same form have to
	 * produce the same key and a genuinely different plan has to produce a different one. The tier code alone
	 * would be enough today — a second plan under the same code is refused above — but the amount and currency
	 * are in it so that a corrected retry after a Stripe refusal is a new request rather than a replay of the
	 * refusal.
	 */
	private static String idempotencyKeyFor(NewPlanRequest request) {
		return "plan:" + request.tierCode() + ":" + request.amount() + ":" + request.currency() + ":"
				+ request.interval();
	}

	/** What the form sends. Boxed like {@code AdministerTiers}', and refused rather than defaulted. */
	record NewPlanRequest(String tierCode, String name, Long amount, String currency, String interval,
			Integer relistQuotaPerPeriod, Map<String, Object> features, Boolean published) {

		NewPlanInStripe asPlan() {
			if (this.amount == null) {
				throw new IllegalArgumentException("A plan states what it costs; guessing would be inventing a price");
			}
			return new NewPlanInStripe(this.tierCode, this.name, this.amount, this.currency, this.interval);
		}

		/**
		 * What the tier grants, which is the same shape the edit form sends — so a plan created here and one
		 * edited afterwards go through one validation rather than two that could differ.
		 */
		TierEdit asGrant() {
			if (this.relistQuotaPerPeriod == null || this.published == null) {
				throw new IllegalArgumentException("A new plan states its quota and whether it is on sale");
			}
			return new TierEdit(this.name, this.relistQuotaPerPeriod,
					this.features == null ? Map.of() : this.features, this.published);
		}

	}

	/**
	 * Stripe's own words about why it would not make the plan.
	 *
	 * <p>Named {@code problem} rather than {@code reason} on purpose: {@code reason} is this API's vocabulary
	 * for a denial about a <em>user</em>, read by clients that act on it, and this is a sentence for an
	 * operator to read. A client that confused the two would report a Stripe validation message to somebody
	 * trying to relist an ad.
	 */
	record Problem(String problem) {
	}

	private final StripePlans stripe;

	private final PriceAdoptions adoptions;

	private final TierEdits catalog;

	private final StripeAccountFacts account;

	static final String PLANS = "/api/admin/plans";

	static final String CURRENCIES = "/api/admin/currencies";

}

/** The {@code 400} for a body that is not JSON, scoped to this controller like its three counterparts. */
@RestControllerAdvice(assignableTypes = CreatePlans.class)
class UnreadableNewPlans {

	@ExceptionHandler(HttpMessageNotReadableException.class)
	ResponseEntity<Void> theRequestCouldNotBeRead(HttpMessageNotReadableException unreadable) {
		return ResponseEntity.badRequest().build();
	}

}
