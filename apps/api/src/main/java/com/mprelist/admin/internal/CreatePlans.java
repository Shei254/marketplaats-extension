package com.mprelist.admin.internal;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.mprelist.billing.NewPlanInStripe;
import com.mprelist.billing.PlanCreation;
import com.mprelist.billing.PlanRhythm;
import com.mprelist.billing.StripeAccountFacts;
import com.mprelist.billing.StripePlans;
import com.mprelist.catalog.PriceAdoptions;
import com.mprelist.catalog.TaggedPrice;
import com.mprelist.catalog.TierEdit;
import com.mprelist.catalog.TierEdited;
import com.mprelist.catalog.TierEdits;

import tools.jackson.databind.JsonNode;

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
 * <li>{@code billing} creates a Product and a Price per rhythm in Stripe, each tagged
 * {@code metadata.tier_code}.
 * <li>{@link PriceAdoptions#adopt} makes the draft row and files each Price under its rhythm — the same call
 * {@code ReceiveStripeEvents} makes.
 * <li>{@link TierEdits#apply} sets the quota, the flags and whether it is on sale — the same call
 * {@code PUT /api/admin/tiers/{code}} makes.
 * </ol>
 *
 * <p><strong>A plan states every rhythm it is sold at, and states them together</strong> (T66). T62 (#128)
 * made a tier able to hold several Prices and left this form writing one, so monthly-and-annual was two acts
 * an operator had to remember — and a plan created with one rhythm is a card offering no choice, which is the
 * choice a buyer is actually making. So the request carries a list, and one submit is one Product with a
 * Price each.
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
	 * The one currency this catalog prices in, for a form to <em>show</em> rather than to choose from
	 * (T63, #129).
	 *
	 * <p>Every tier is priced in it. A plan screen is a comparison and €9,99 against $12.99 is not one a buyer
	 * can make, so the currency is not a choice per plan — and since it is not a choice, no request carries
	 * one and there is no way to produce a mixed catalog through this API at all.
	 *
	 * <p>{@code 503} rather than a guess when Stripe cannot be asked: the alternative is a form that creates a
	 * Price in a currency the account cannot settle in, which Stripe refuses at the worst moment.
	 */
	@GetMapping(path = CURRENCY)
	ResponseEntity<CatalogCurrency> currency() {
		return this.account.sellingCurrency()
				.map(currency -> ResponseEntity.ok(new CatalogCurrency(currency)))
				.orElseGet(() -> ResponseEntity.status(503).build());
	}

	/** The one currency every tier is priced in. An object, so it can grow a field. */
	record CatalogCurrency(String currency) {
	}

	@PostMapping(path = PLANS, consumes = MediaType.APPLICATION_JSON_VALUE)
	ResponseEntity<?> create(@RequestBody NewPlanRequest request) {
		/*
		 * Everything about the *request* is answered before anything about our ability to act on it — so an
		 * operator who typed a code that is taken is told that, rather than being told Stripe is unreachable
		 * and discovering the clash on the retry. The order was the other way round first, and the suite
		 * caught it.
		 */
		TierEdit grant;
		try {
			grant = request.asGrant();
			request.asPlan("eur");
		}
		catch (IllegalArgumentException unusable) {
			return ResponseEntity.badRequest().build();
		}

		// A code the catalog already holds is refused rather than adopted, and this is the check that makes
		// "create" mean create. Without it the adopt below would repoint an existing tier's Price — the
		// upsert's ordinary behaviour, correct for a webhook and quite wrong for a button labelled New plan:
		// every current subscriber would keep paying the old amount while the tier advertised the new one.
		if (this.catalog.everyTier().stream().anyMatch(tier -> tier.tier().code().equals(request.tierCode()))) {
			return ResponseEntity.status(409).build();
		}

		Optional<String> currency = this.account.sellingCurrency();
		if (currency.isEmpty()) {
			return ResponseEntity.status(422).body(new Problem("Stripe could not say what this account "
					+ "settles in, so a plan cannot be priced. Try again in a moment."));
		}
		NewPlanInStripe plan = request.asPlan(currency.get());

		// One call, switched on. An earlier draft asked Stripe again on the refusal path, which is a second
		// round trip to be told the same thing — and, with a repeated idempotency key, a replay of it.
		PlanCreation made = this.stripe.create(plan, idempotencyKeyFor(request));
		if (made instanceof PlanCreation.Refused refused) {
			return ResponseEntity.status(422).body(new Problem(refused.because()));
		}
		PlanCreation.Created created = (PlanCreation.Created) made;

		// The webhook's own call once per rhythm, and then the edit form's. Nothing here writes a row of its
		// own. What is adopted is what Stripe *made*, which since T66 need not be everything that was asked
		// for: a plan whose annual Price was refused after its monthly one landed is created selling by the
		// month, and the answer carries the prices it actually has for the screen to notice the gap in.
		for (PlanCreation.CreatedPrice price : created.prices()) {
			this.adoptions.adopt(new TaggedPrice(created.tierCode(), price.stripePriceId(), price.interval(),
					created.name()));
		}
		return switch (this.catalog.apply(plan.tierCode(), grant)) {
			case TierEdited.Applied applied ->
				ResponseEntity.status(201).body(AdministerTiers.asAdminTier(applied.tier()));
			// Both unreachable: the adopt above has just written the row, and wrote a price id with it.
			// Reported rather than swallowed, because unreachable is a claim and this is where it would fail.
			case TierEdited.NoSuchTier ignored -> ResponseEntity.status(500).build();
			case TierEdited.NothingToChargeAgainst ignored -> ResponseEntity.status(500).build();
			// Unreachable like the two above it, and for a reason of its own: `asGrant` refuses a
			// zero-grant plan that asked to be on sale before Stripe is touched (ADR-0029), so nothing that
			// reaches here can be one. Reported rather than swallowed, because unreachable is a claim and
			// this is where it would fail.
			case TierEdited.NothingToGrant ignored -> ResponseEntity.status(500).build();
		};
	}

	/**
	 * {@code POST /api/admin/tiers/{code}/prices} — a second rhythm for a plan that already exists, and the
	 * way a plan is repriced without leaving the screen (T62, #128).
	 *
	 * <p><strong>One route for both, because in Stripe they are one act.</strong> Adding an annual price to a
	 * monthly Pro and changing Pro's monthly price are the same request — create a Price tagged {@code pro} —
	 * and what decides which happened is whether the tier already has a row for that rhythm. Adding lands
	 * beside the existing one; repricing replaces it, and everybody already subscribed keeps the Price they
	 * bought, because that is what Stripe's immutability means and no screen can change it.
	 *
	 * <p>It does <strong>not</strong> touch the quota, the name or whether the tier is on sale: those are the
	 * edit form's, and a tier that was withdrawn does not come back on sale because a price was added to it.
	 */
	@PostMapping(path = TIER_PRICES, consumes = MediaType.APPLICATION_JSON_VALUE)
	ResponseEntity<?> addPrice(@PathVariable String code, @RequestBody NewPriceRequest request) {
		// The request, then the tier, then our ability to price it — same order as above and for the same
		// reason: a code nothing stores is news the operator can act on without Stripe being reachable.
		try {
			request.asPlanFor(code, code, "eur");
		}
		catch (IllegalArgumentException unusable) {
			return ResponseEntity.badRequest().build();
		}
		String name = nameOf(code);
		if (name == null) {
			return ResponseEntity.notFound().build();
		}
		Optional<String> currency = this.account.sellingCurrency();
		if (currency.isEmpty()) {
			return ResponseEntity.status(422).body(new Problem("Stripe could not say what this account "
					+ "settles in, so a price cannot be created. Try again in a moment."));
		}
		NewPlanInStripe price = request.asPlanFor(code, name, currency.get());

		PlanCreation made = this.stripe.create(price,
				"price:" + code + ":" + request.amount() + ":" + request.interval());
		if (made instanceof PlanCreation.Refused refused) {
			return ResponseEntity.status(422).body(new Problem(refused.because()));
		}
		PlanCreation.Created created = (PlanCreation.Created) made;

		// The webhook's own call again, which is what slots the Price into the right rhythm — adding a row
		// where there was none, and replacing the id where there was one. One rhythm was asked for, so one
		// came back; the loop is over a list that is always of length one rather than an index that assumes it.
		for (PlanCreation.CreatedPrice one : created.prices()) {
			this.adoptions.adopt(new TaggedPrice(code, one.stripePriceId(), one.interval(), null));
		}
		return this.catalog.everyTier().stream()
				.filter(tier -> tier.tier().code().equals(code))
				.findFirst()
				.map(AdministerTiers::asAdminTier)
				.<ResponseEntity<?>>map(ResponseEntity::ok)
				.orElseGet(() -> ResponseEntity.status(500).build());
	}

	/** The tier's current name, or {@code null} where no tier carries that code. */
	private String nameOf(String code) {
		return this.catalog.everyTier().stream()
				.filter(tier -> tier.tier().code().equals(code))
				.map(tier -> tier.tier().name())
				.findFirst()
				.orElse(null);
	}

	/**
	 * What the add-a-rhythm form sends: an amount and a rhythm, and nothing about the tier itself.
	 *
	 * <p>Also what one entry of the new-plan form's {@code prices} is, which is why {@link #asRhythm()} exists
	 * on it: adding a rhythm to a plan and stating one while creating it are the same two fields, and reading
	 * them in two places is two chances to guard them differently.
	 */
	record NewPriceRequest(Long amount, String interval) {

		/**
		 * @throws IllegalArgumentException on a price that does not say what it costs, or says a recurrence
		 * Stripe has no word for — {@link PlanRhythm} is where the vocabulary lives, so this refusal happens
		 * before Stripe is asked for anything
		 */
		PlanRhythm asRhythm() {
			if (this.amount == null) {
				throw new IllegalArgumentException("A price states what it costs");
			}
			if (this.interval == null || this.interval.isBlank()) {
				throw new IllegalArgumentException("A price states how often it recurs");
			}
			return new PlanRhythm(this.amount, this.interval);
		}

		/**
		 * The Stripe Product is named after the tier it belongs to, so a second rhythm does not create a
		 * differently-named Product beside the first. The name is read from the catalog rather than sent,
		 * because renaming a tier is the edit form's job and this form should not be able to do it by accident.
		 */
		NewPlanInStripe asPlanFor(String code, String name, String currency) {
			return new NewPlanInStripe(code, name == null ? code : name, currency, List.of(asRhythm()));
		}

	}

	/**
	 * What makes a double-submitted form one plan rather than two.
	 *
	 * <p>Derived from what was asked for rather than from a clock or a random value, which is the only version
	 * that works: Stripe replays the first answer for a repeated key, so two clicks on the same form have to
	 * produce the same key and a genuinely different plan has to produce a different one. The tier code alone
	 * would be enough today — a second plan under the same code is refused above — but the amounts are in it
	 * so that a corrected retry after a Stripe refusal is a new request rather than a replay of the refusal.
	 * Since T66 that means every rhythm's amount: correcting only the annual one is still a correction.
	 */
	private static String idempotencyKeyFor(NewPlanRequest request) {
		return "plan:" + request.tierCode() + ":" + String.join(",", request.prices().stream()
				.map(price -> price.amount() + "@" + price.interval())
				.toList());
	}

	/**
	 * What the form sends. Boxed like {@code AdministerTiers}', and refused rather than defaulted.
	 *
	 * <p><strong>{@code prices} is a list because a plan is</strong> (T66): monthly and annual Pro are one
	 * plan somebody picks a rhythm for, so both amounts are stated on the one form that creates it. A single
	 * {@code amount} and {@code interval} was the shape T61 shipped, and it made the second rhythm a separate
	 * act an operator had to remember — with a plan card offering no choice in between.
	 */
	record NewPlanRequest(String tierCode, String name, List<NewPriceRequest> prices,
			JsonNode relistQuotaPerPeriod, Map<String, Object> features, Boolean published) {

		/**
		 * @param currency the catalog's, not the caller's (T63, #129). There is no currency on this record on
		 * purpose: one that could be sent could be sent differently for two tiers, and the plan screen would
		 * then ask a buyer to compare two currencies. Unsayable beats validated, which is the same move
		 * {@code isDefault} made.
		 */
		NewPlanInStripe asPlan(String currency) {
			if (this.prices == null || this.prices.isEmpty()) {
				throw new IllegalArgumentException("A plan states what it costs; guessing would be inventing a price");
			}
			List<PlanRhythm> rhythms = this.prices.stream().map(price -> {
				if (price == null) {
					throw new IllegalArgumentException("A price states what it costs");
				}
				return price.asRhythm();
			}).toList();
			return new NewPlanInStripe(this.tierCode, this.name, currency, rhythms);
		}

		/**
		 * What the tier grants, which is the same shape the edit form sends — so a plan created here and one
		 * edited afterwards go through one validation rather than two that could differ.
		 */
		/**
		 * <p>The quota is read by {@link AdministerTiers#quotaIn}, which is where ADR-0029's rule for the
		 * write side lives: absent is a refusal, an explicit JSON {@code null} is unlimited. Read there
		 * rather than here for the same reason this method exists at all — a plan created on this form and
		 * one edited on the next screen should not be able to disagree about what a quota may say.
		 */
		TierEdit asGrant() {
			if (this.relistQuotaPerPeriod == null || this.published == null) {
				throw new IllegalArgumentException("A new plan states its quota and whether it is on sale");
			}
			TierEdit grant = new TierEdit(this.name, AdministerTiers.quotaIn(this.relistQuotaPerPeriod),
					this.features == null ? Map.of() : this.features, this.published);
			/*
			 * A plan that grants nothing cannot be on sale (ADR-0029), and *this* is the route where that has
			 * to be said before anything happens rather than after. The edit form's counterpart answers a
			 * typed `NothingToGrant` at the end, which costs nothing there because nothing has been done
			 * yet; here the same answer would arrive with a Stripe Product and its Prices already created,
			 * as a 409 indistinguishable from the one that means "that code is taken" — so an operator would
			 * rename and retry, and make a second Product.
			 *
			 * Answered as an unusable body instead, which is the order this class already keeps: everything
			 * about the request before anything about our ability to act on it.
			 */
			if (grant.published() && Integer.valueOf(0).equals(grant.relistQuotaPerPeriod())) {
				throw new IllegalArgumentException("A plan granting no reposts is not one to put on sale; "
						+ "create it unpublished and say what it grants first");
			}
			return grant;
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

	static final String CURRENCY = "/api/admin/currency";

	static final String TIER_PRICES = "/api/admin/tiers/{code}/prices";

}

/** The {@code 400} for a body that is not JSON, scoped to this controller like its three counterparts. */
@RestControllerAdvice(assignableTypes = CreatePlans.class)
class UnreadableNewPlans {

	@ExceptionHandler(HttpMessageNotReadableException.class)
	ResponseEntity<Void> theRequestCouldNotBeRead(HttpMessageNotReadableException unreadable) {
		return ResponseEntity.badRequest().build();
	}

}
