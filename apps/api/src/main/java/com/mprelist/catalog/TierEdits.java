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
	 * Delete the tier stored under {@code code}, and answer with the catalog that is left (T77,
	 * <a href="../../../../../../../docs/adr/0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md">ADR-0032</a>).
	 *
	 * <p><strong>Every tier is deletable, the default one and the last one included</strong>, which is that
	 * ADR's first decision and the one everything else in it pays for. The narrower answers — refuse the
	 * default and make an operator move the flag first, or soft-delete behind a {@code retired_at} — were
	 * weighed and both fail on the same point: they make an operator's own catalog something the data model
	 * has an opinion about. So an empty catalog is reachable, and it is <strong>a state and not
	 * corruption</strong>.
	 *
	 * <p><strong>What this method does not do is as decided as what it does.</strong> It does not move
	 * subscribers and it does not cancel anything in Stripe. Both are true of a delete and neither is this
	 * module's: {@code subscription} owns the rows the people are in, and Stripe is {@code billing}'s. They
	 * are composed with this in one transaction by {@code admin}, which is the module allowed to know about
	 * more than one of them — see {@code CatalogAndSubscribers}. What is this module's, and is here, is the
	 * {@code tier} row itself, the {@code tier_price} rows that cascade with it (V7), and the
	 * {@link TierTeardown} rows that capture the Stripe work before either disappears.
	 *
	 * <p><strong>Deleting a code nothing is stored under is not a refusal.</strong> The caller that has an
	 * operator to answer has already read the row — it needs the tier's Prices to enqueue the tear-down —
	 * so a second existence check here would be a second opinion about a question already asked, and the
	 * {@code 404} is answered where the lookup happened. What this promises is that afterwards no tier
	 * carries that code.
	 *
	 * @param code the tier to delete
	 * @return the catalog as it now stands, in the Catalog order — the same list {@link #everyTier()} gives,
	 * read back inside the write's own transaction, because the screen has rows to remove, positions to
	 * redraw and possibly a default flag that is no longer anywhere
	 */
	List<CatalogEntry> delete(String code);

	/**
	 * Make this tier the one new accounts are provisioned onto.
	 *
	 * <p><strong>A move, never a toggle, and that is still the whole design of it</strong> — though not
	 * quite for the reason it was. This used to say that a catalog with no default takes down every new
	 * sign-in, because {@link TierCatalog#defaultTier()} threw and {@code ProvisionOnFirstLogin} caught
	 * nothing. Since T77 neither is true: the default may be deleted, provisioning writes a tier-less row,
	 * and those accounts are denied {@code NO_TIER} rather than refused at the door. What survives is the
	 * shape — expressed as "make this one the default" there is no request anybody can send that <em>clears</em>
	 * the flag, so the one way to reach a catalog with no default is to delete the tier holding it, which is
	 * a deliberate act with a confirmation in front of it.
	 *
	 * <p><strong>It is also what heals the orphans</strong>, and that is composed on top of this rather than
	 * done here for {@link #delete(String)}'s reason: a tier-less subscription is {@code subscription}'s row.
	 * A subscription names no tier <em>only</em> because no default existed, and this is the sole writer of
	 * the flag — so the moment it runs is the only moment that stops being true, and everybody on the wrong
	 * side of it heals at once, including users who never sign in again.
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
