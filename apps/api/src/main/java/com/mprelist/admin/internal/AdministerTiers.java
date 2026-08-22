package com.mprelist.admin.internal;

import java.util.List;
import java.util.Map;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.mprelist.catalog.CatalogEntry;
import com.mprelist.catalog.TierEdit;
import com.mprelist.catalog.TierEdited;
import com.mprelist.catalog.TierEdits;

/**
 * The tier catalog, as an operator works on it (T53, #84) — the CRUD ADR-0014 deferred and ADR-0019
 * un-deferred once iteration 1 had something to sell.
 *
 * <p><strong>Everything here is guarded by being here.</strong> {@code OperatorsOnly} closes
 * {@code /api/admin/**} on the realm's {@code ADMIN} role before routing, so none of these methods asks and
 * none of them can forget to. What a caller without the role gets is the resource server's own {@code 403},
 * pinned by {@code AdminGuardTest}.
 *
 * <p><strong>Three routes, and the third exists to make an invariant unbreakable.</strong> Listing and
 * editing are what a catalog screen needs; {@code PUT …/default} is separate because the default tier is a
 * property of the <em>catalog</em> rather than of one row. Exactly one tier carries it, and a catalog with
 * none takes down every new sign-in — {@code TierCatalog.defaultTier()} throws and
 * {@code ProvisionOnFirstLogin} catches nothing. Written as "make this one the default", there is no request
 * anybody can send that leaves the catalog with none. The alternative — a boolean on the edit body, refused
 * when it would clear the last one — needs a refusal, a status for it, a message for it and a test that the
 * refusal works, all to defend something that can simply be made unsayable.
 *
 * <p><strong>What it deliberately cannot do:</strong> create a tier, delete one, or set a price. A tier is
 * created by tagging a Stripe Price with its code (ADR-0019) and the sync drafts the row; nothing here
 * deletes, because a subscription references its tier behind a foreign key and the way to retire a plan is to
 * unpublish it and let its subscribers finish. The amount is Stripe's and immutable.
 */
@RestController
class AdministerTiers {

	AdministerTiers(TierEdits catalog) {
		this.catalog = catalog;
	}

	/**
	 * Every tier, drafts and the free tier included — see {@link TierEdits#everyTier()} for why unfiltered is
	 * the point.
	 *
	 * <p>No amount on any of them, and that is not an omission: money is Stripe's (ADR-0014), and this screen
	 * has to be readable when Stripe is not. An operator locked out of their own catalog during a Stripe
	 * outage would be locked out of the one tool that could work around it.
	 */
	@GetMapping(path = TIERS)
	Tiers everyTier() {
		return new Tiers(this.catalog.everyTier().stream().map(AdministerTiers::asAdminTier).toList());
	}

	/**
	 * The editable half of one tier, stated whole.
	 *
	 * <p>A {@code PUT} rather than a {@code PATCH} because the body is total over what may be changed: every
	 * field is sent every time, so there is no "absent or null" question for a reader to answer differently
	 * from the next one, and the form on the other side (T54, #85) is holding all four values anyway.
	 *
	 * <p>{@code 409} is the one refusal, and it means one thing: publishing a tier with nothing to charge
	 * against. It carries an empty body like every other non-denial {@code 4xx} here — there is exactly one
	 * way for this route to conflict, so the status is the whole of the message and a {@code reason} would be
	 * a second vocabulary on an API whose codes are statements about a *user*.
	 */
	@PutMapping(path = TIERS + "/{code}", consumes = MediaType.APPLICATION_JSON_VALUE)
	ResponseEntity<AdminTier> edit(@PathVariable String code, @RequestBody TierEditRequest request) {
		TierEdit edit;
		try {
			edit = request.asEdit();
		}
		catch (IllegalArgumentException unusable) {
			// A name that is blank or a quota below zero: a body this API could read and could not use, which
			// is the same `400` an unparseable one gets rather than a state to store.
			return ResponseEntity.badRequest().build();
		}
		return switch (this.catalog.apply(code, edit)) {
			case TierEdited.Applied applied -> ResponseEntity.ok(asAdminTier(applied.tier()));
			case TierEdited.NoSuchTier ignored -> ResponseEntity.notFound().build();
			case TierEdited.NothingToChargeAgainst ignored -> ResponseEntity.status(409).build();
		};
	}

	/**
	 * Move the default flag to this tier — the one new accounts are provisioned onto.
	 *
	 * <p>Idempotent: naming the tier that already holds it changes nothing and answers the same, which is what
	 * makes a form safe to submit twice. **"No free tier" is not this route** — it is a quota of 0 on
	 * whichever tier is the default (ADR-0019), which keeps every new user provisioned and refuses their
	 * relists down the path that already works.
	 */
	@PutMapping(path = TIERS + "/{code}/default")
	ResponseEntity<AdminTier> makeDefault(@PathVariable String code) {
		return this.catalog.makeDefault(code)
				.map(AdministerTiers::asAdminTier)
				.map(ResponseEntity::ok)
				.orElseGet(() -> ResponseEntity.notFound().build());
	}

	/**
	 * One tier as the admin screen renders it.
	 *
	 * <p>{@code tier} carries both spellings for the reason {@code /api/me} does: {@code code} is the stable
	 * handle an edit never moves and {@code name} is text an operator is about to rewrite, so a client that
	 * had only the second would key its own rows on something that changes under it.
	 */
	record AdminTier(TierNameOnTheWire tier, int relistQuotaPerPeriod, Map<String, Object> features,
			boolean published, boolean isDefault, List<TierPriceOnTheWire> prices) {
	}

	/**
	 * One of the Stripe Prices a tier is sold at (T62, #128) — the id to find it by in the dashboard, and the
	 * rhythm that tells it from the tier's others. No amount: money is Stripe's, and this screen has to be
	 * readable when Stripe is not.
	 */
	record TierPriceOnTheWire(String stripePriceId, String interval) {
	}

	/** The pair, spelled as this API spells it everywhere else. */
	record TierNameOnTheWire(String code, String name) {
	}

	/** An object rather than a bare array, so the answer can grow a field without breaking every reader. */
	record Tiers(List<AdminTier> tiers) {
	}

	/**
	 * What the form sends. Boxed, so that a field left out of the body is distinguishable from one sent as
	 * zero or false — and refused rather than silently defaulted, since defaulting `published` to false would
	 * quietly unpublish a plan and defaulting a quota to 0 would quietly strip one.
	 */
	record TierEditRequest(String name, Integer relistQuotaPerPeriod, Map<String, Object> features,
			Boolean published) {

		TierEdit asEdit() {
			if (this.relistQuotaPerPeriod == null || this.published == null) {
				throw new IllegalArgumentException("An edit states every field it may change; this one left "
						+ "out the quota or the publication flag, and guessing either would change a plan "
						+ "nobody asked to change");
			}
			return new TierEdit(this.name, this.relistQuotaPerPeriod,
					this.features == null ? Map.of() : this.features, this.published);
		}

	}

	/** Package-visible: {@code CreatePlans} answers with the same shape, read back the same way. */
	static AdminTier asAdminTier(CatalogEntry entry) {
		return new AdminTier(new TierNameOnTheWire(entry.tier().code(), entry.tier().name()),
				entry.relistQuotaPerPeriod(), entry.features(), entry.published(), entry.isDefault(),
				entry.prices().stream()
						.map(price -> new TierPriceOnTheWire(price.stripePriceId(), price.interval()))
						.toList());
	}

	private final TierEdits catalog;

	static final String TIERS = "/api/admin/tiers";

}

/**
 * The {@code 400} these routes answer when the body is not JSON, or not JSON of the shape above.
 *
 * <p>An empty body, and scoped to this controller rather than declared globally, for the reasons its two
 * counterparts in {@code enforcement} and {@code billing} give: an advice naming no types decides the shape of
 * every route in the application, and Spring wires it by annotation where the boundary check cannot see it.
 */
@RestControllerAdvice(assignableTypes = AdministerTiers.class)
class UnreadableTierEdits {

	@ExceptionHandler(HttpMessageNotReadableException.class)
	ResponseEntity<Void> theRequestCouldNotBeRead(HttpMessageNotReadableException unreadable) {
		return ResponseEntity.badRequest().build();
	}

}
