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

import tools.jackson.databind.JsonNode;

/**
 * The tier catalog, as an operator works on it (T53, #84) — the CRUD ADR-0014 deferred and ADR-0019
 * un-deferred once iteration 1 had something to sell.
 *
 * <p><strong>Everything here is guarded by being here.</strong> {@code OperatorsOnly} closes
 * {@code /api/admin/**} on the realm's {@code ADMIN} role before routing, so none of these methods asks and
 * none of them can forget to. What a caller without the role gets is the resource server's own {@code 403},
 * pinned by {@code AdminGuardTest}.
 *
 * <p><strong>Four routes, and two of them are here because a catalog is not a bag of rows.</strong> Listing
 * and editing are what a catalog screen needs; {@code PUT …/default} is separate because the default tier is
 * a property of the <em>catalog</em> rather than of one row. Exactly one tier carries it, and a catalog with
 * none takes down every new sign-in — {@code TierCatalog.defaultTier()} throws and
 * {@code ProvisionOnFirstLogin} catches nothing. Written as "make this one the default", there is no request
 * anybody can send that leaves the catalog with none. The alternative — a boolean on the edit body, refused
 * when it would clear the last one — needs a refusal, a status for it, a message for it and a test that the
 * refusal works, all to defend something that can simply be made unsayable.
 *
 * <p>{@code PUT …/order} is the fourth and is separate for exactly the same reason (T75, #164, ADR-0030):
 * moving a tier moves others, so the order is the catalog's and not a field on {@link TierEdit}. It carries
 * the whole sequence, so one drag is one request and there is no half-applied order for a failed third call
 * to leave behind.
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
	 * <p>{@code 409} is the one refusal, and it means one thing said two ways: <strong>this tier cannot go on
	 * sale as described</strong> — either there is nothing to charge for it (no Stripe Price) or nothing to
	 * get for the money (a quota of 0, ADR-0029). It carries an empty body like every other non-denial
	 * {@code 4xx} here, and the two are not told apart on the wire: a {@code reason} would be a second
	 * vocabulary on an API whose codes are statements about a *user*, and the screen that sends this shows
	 * both facts on the row it is editing. The form warns and withdraws the tier itself rather than sending
	 * a publish it knows will be refused, so what reaches this is a stale tab, a script or a hand-run
	 * {@code curl} — which should be told they are wrong rather than quietly corrected.
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
			case TierEdited.NothingToGrant ignored -> ResponseEntity.status(409).build();
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
	 * Set the order the catalog is read in — every tier, in the sequence the plan cards should appear (T75,
	 * #164; ADR-0030).
	 *
	 * <p><strong>A literal segment where {@code {code}} would match, which is a collision worth naming.</strong>
	 * Spring prefers the exact pattern, so this handler and not {@link #edit} takes {@code /api/admin/tiers/order}
	 * — at the cost of a tier coded {@code order} being uneditable through this API. Nothing creates one: a code
	 * is derived from a plan's name in {@code /admin} or typed into a Stripe Price's {@code metadata.tier_code},
	 * and the operator who managed both would find out on the first save rather than silently.
	 *
	 * <p><strong>{@code 409} with an empty body is the one refusal, and it means the screen is stale.</strong>
	 * A code nothing is stored under, a tier the list forgot and a code sent twice are one event to the only
	 * caller — reload and try again — so splitting them into a {@code 404} and a {@code 409} would be two
	 * statuses for one recovery. It doubles as the concurrency check: a draft the Stripe sync adopted while the
	 * page was open makes the list incomplete, and the write is refused rather than quietly filing the new tier
	 * wherever the renumbering left it.
	 *
	 * <p><strong>The answer is the whole catalog in its new order</strong>, the same body {@link #everyTier()}
	 * gives, read back inside the write's own transaction. The screen has already moved the row optimistically,
	 * so this is what it reconciles against — and it is the shape every other write here answers with, for the
	 * same reason: what was stored rather than what was hoped for. <strong>No {@code position} travels on it</strong>
	 * — the array is in order, and a number beside an ordered array is one fact spelled twice (ADR-0026).
	 */
	@PutMapping(path = TIERS + "/order", consumes = MediaType.APPLICATION_JSON_VALUE)
	ResponseEntity<Tiers> reorder(@RequestBody CatalogOrderRequest request) {
		if (request.codes() == null) {
			return ResponseEntity.badRequest().build();
		}
		return this.catalog.reorder(request.codes())
				.map(tiers -> new Tiers(tiers.stream().map(AdministerTiers::asAdminTier).toList()))
				.map(ResponseEntity::ok)
				.orElseGet(() -> ResponseEntity.status(409).build());
	}

	/**
	 * One tier as the admin screen renders it.
	 *
	 * <p>{@code tier} carries both spellings for the reason {@code /api/me} does: {@code code} is the stable
	 * handle an edit never moves and {@code name} is text an operator is about to rewrite, so a client that
	 * had only the second would key its own rows on something that changes under it.
	 */
	record AdminTier(TierNameOnTheWire tier, Integer relistQuotaPerPeriod, Map<String, Object> features,
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
	 *
	 * <p><strong>The quota is a {@link JsonNode} rather than an {@code Integer}, and that is the whole of
	 * ADR-0029's write side.</strong> Everywhere else on this request, and everywhere else in this API,
	 * {@code null} means <em>you forgot it</em>. Since a quota of {@code null} is how unlimited is spelled,
	 * this one field has to answer "absent" and "explicit null" differently: absent is a {@code 400}, an
	 * explicit JSON {@code null} is unlimited.
	 *
	 * <p>{@code JsonNode} is the mechanism <em>because it was the one that worked</em>. ADR-0029 left this
	 * open at build time — there is no precedent for the distinction in this codebase — so both candidates
	 * were run against Jackson 3 first: an {@code Optional<Integer>} component answers {@code Optional.empty()}
	 * for absent <em>and</em> for an explicit null, which is exactly the distinction that is needed and
	 * exactly the one it cannot make. A {@code JsonNode} component arrives as a Java {@code null} when the
	 * field is absent and as a {@code NullNode} when it is written out, which is the two facts kept apart by
	 * the type system rather than by a convention.
	 */
	record TierEditRequest(String name, JsonNode relistQuotaPerPeriod, Map<String, Object> features,
			Boolean published) {

		TierEdit asEdit() {
			if (this.relistQuotaPerPeriod == null || this.published == null) {
				throw new IllegalArgumentException("An edit states every field it may change; this one left "
						+ "out the quota or the publication flag, and guessing either would change a plan "
						+ "nobody asked to change");
			}
			return new TierEdit(this.name, quotaSent(this.relistQuotaPerPeriod),
					this.features == null ? Map.of() : this.features, this.published);
		}

	}

	/**
	 * What the catalog table sends when a row is dropped somewhere new: the whole sequence, by code.
	 *
	 * <p><strong>Codes rather than ids, like every other body on this API</strong> — the code is the stable
	 * handle nothing renames (ADR-0014), and it is what the screen already keys its rows on.
	 *
	 * <p>Absent is a {@code 400} and never an empty catalog: a body with no {@code codes} is one this API
	 * could read and could not use, and the ordering it would otherwise be taken to ask for — none of the
	 * tiers, in no order — is not something any screen means.
	 */
	record CatalogOrderRequest(List<String> codes) {
	}

	/**
	 * The quota as an edit means it: {@code null} for unlimited (ADR-0029), the number otherwise, and a
	 * refusal for anything that is neither.
	 *
	 * <p>Package-visible because {@link CreatePlans} sends the same field on its own form and has to read it
	 * the same way — two readings of one wire field is two chances for a create and an edit to disagree about
	 * what unlimited is. Absence is <em>not</em> answered here: it is a different refusal with a different
	 * sentence, and only the caller knows which of its fields was missing.
	 *
	 * @param quota the node the field arrived as, never Java {@code null} — its callers have checked
	 */
	static Integer quotaSent(JsonNode quota) {
		if (quota.isNull()) {
			return null;
		}
		if (!quota.isIntegralNumber()) {
			throw new IllegalArgumentException("A quota is a whole number of reposts, or null for unlimited; "
					+ "this one is " + quota.getClass().getSimpleName());
		}
		return quota.asInt();
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
