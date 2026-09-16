package com.mprelist.catalog;

import java.util.List;
import java.util.Optional;

/**
 * How an operator reads and changes the catalog (T53, #84) — the writes ADR-0014 deferred and
 * <a href="../../../../../../../docs/adr/0019-plans-are-stripe-first-and-webhook-synced.md">ADR-0019</a>
 * un-deferred.
 *
 * <p>A third port beside {@link TierCatalog} and {@link PriceAdoptions} rather than more methods on either,
 * for the reason those two are separate from each other: {@code TierCatalog} is read on the authorize path by
 * a gate that must not be able to write, and {@code PriceAdoptions} is written to by a webhook that must not
 * be able to set a quota. This one can do both and is reachable only from behind the {@code ADMIN} role — so
 * keeping it apart is what stops any of the three from acquiring a capability its caller never needed.
 *
 * <p><strong>Everything here is about the catalog and nothing is about a subscriber.</strong> Lowering a
 * quota changes what every subscriber on that tier is granted from the next read onward, and it writes
 * nothing to any of their rows: what is left of a period is the grant minus what has been spent, so the
 * arithmetic follows the edit by itself. That is why there is no notification, no proration and no migration
 * here — and why there is nothing to undo either.
 */
public interface TierEdits {

	/**
	 * Every tier, drafts and all, in the <strong>Catalog order</strong>.
	 *
	 * <p>That order is an operator's own since T75 (#164, ADR-0030) and was {@code relist_quota_per_period,
	 * code} before it — cheapest grant first, which nobody chose and which cannot say which plan to put first.
	 * It is the same sequence {@code GET /api/plans} renders the published subsequence of, so the list an
	 * operator arranges and the cards a buyer reads cannot disagree.
	 *
	 * <p><strong>Unfiltered, which is the point.</strong> {@link TierCatalog#published()} deliberately hides a
	 * draft — the row ADR-0019's sync creates at quota 0 for a Price nobody has decided about — and hiding it
	 * here too would leave an operator with no way to find the thing they are supposed to act on. The same
	 * goes for the free tier, which is never sellable and is very much editable.
	 *
	 * <p>A list rather than a page: the catalog is a handful of rows maintained by hand, and the screen shows
	 * all of them.
	 */
	List<CatalogEntry> everyTier();

	/**
	 * Apply an operator's edit to the tier stored under {@code code}.
	 *
	 * <p>Total over the editable fields — see {@link TierEdit} for what is not among them and why. The answer
	 * carries the row as it now stands rather than the request echoed back, so a client renders what was
	 * stored rather than what it hoped would be.
	 *
	 * <p><strong>{@code code} names the row and {@code edit.code()} says where it should be filed</strong>,
	 * and they are the same string on every edit but one (T76, ADR-0031). They may differ exactly while the
	 * tier has no {@code tier_price} row: beyond that Stripe holds a copy of the code on every Price and the
	 * sync reads it back, so moving ours would split one tier in two on the next {@code price.updated}. In
	 * practice the tier that qualifies is the free one and there is only ever one of it — which is derived
	 * from the price list rather than flagged, and needs no constraint because no creation path can make a
	 * second (ADR-0031).
	 *
	 * @param code the handle the row is stored under now, which is how it is found
	 * @param edit the whole editable half of the row, including the handle it should be stored under next
	 * @return applied, or which of the four ways it could not be
	 */
	TierEdited apply(String code, TierEdit edit);

	/**
	 * Set the Catalog order: every tier there is, in the sequence the plan cards should read (T75, #164).
	 *
	 * <p><strong>The whole sequence rather than one tier's place</strong>, and for the reason
	 * {@link #makeDefault(String)} is a move rather than a toggle: the order is a property of the catalog and
	 * not of a row. Moving one tier moves others, so an index on {@link TierEdit} would turn one drag into N
	 * requests a client sequenced itself — non-atomically, leaving a half-applied order nobody chose if the
	 * third one failed.
	 *
	 * <p><strong>Every tier carries a place, including the ones no buyer sees.</strong> The free tier is never
	 * a plan card and a draft is not one yet, and both are in this list: a position that existed only while a
	 * tier was published would be lost the first afternoon somebody withdrew a plan and opened it again
	 * (ADR-0030). Dragging {@code free} to the top therefore changes nothing a buyer sees, which the admin
	 * table already says by marking which rows are on sale.
	 *
	 * <p><strong>Nothing but the catalog's own set will do.</strong> A code stored under no tier, a tier the
	 * list left out and a code named twice are refused identically, because they are one event to the only
	 * caller: the screen is stale. That is also the concurrency check — a tier the Stripe sync drafted while
	 * the page was open makes the list incomplete, and being refused is how the operator finds out rather than
	 * discovering the new plan filed wherever a renumbering left it.
	 *
	 * @param codes every tier in the catalog, in order
	 * @return the catalog as it now stands, in its new order, or nothing where {@code codes} is not exactly
	 * the set of codes the catalog holds
	 */
	Optional<List<CatalogEntry>> reorder(List<String> codes);

	/**
	 * Make this tier the one new accounts are provisioned onto.
	 *
	 * <p><strong>A move, never a toggle, and that is the whole design of it.</strong> The catalog must carry
	 * exactly one default: {@link TierCatalog#defaultTier()} throws when no row does and
	 * {@code ProvisionOnFirstLogin} catches nothing, so a catalog with none takes down every new sign-in — and
	 * the operator who caused it would see nothing wrong on their own screen. Expressed as "make this one the
	 * default" rather than as a boolean per tier, there is no request that can leave the catalog with none, so
	 * the invariant needs no refusal to defend it and no test to prove the refusal works.
	 *
	 * <p>Naming the tier that already holds it is allowed and changes nothing, which is what makes a form that
	 * submits every field safe to submit twice.
	 *
	 * <p>"No free tier" is <strong>not</strong> done here. It is a quota of 0 on whichever tier is the default
	 * (ADR-0019): every new user is still provisioned, the invariant holds, and every relist is refused with
	 * {@code QUOTA_EXCEEDED} down a path that already works end to end.
	 *
	 * @param code the tier to move the flag to
	 * @return the row as it now stands, or nothing where no tier carries that code
	 */
	Optional<CatalogEntry> makeDefault(String code);

}
