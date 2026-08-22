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
	 * Every tier, drafts and all, cheapest grant first.
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
	 * @param code the stable handle, which this never changes
	 * @param edit the whole editable half of the row
	 * @return applied, or which of the two ways it could not be
	 */
	TierEdited apply(String code, TierEdit edit);

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
