/**
 * Where on **Mijn Advertenties** a **Page button** goes (ADR-0040).
 *
 * One row of that page carries two *Sneller verkopen* controls with the ad's id
 * on them — a `hz-Button` for wide screens and a `hz-Link` for narrow ones, one of
 * them hidden by Marktplaats's own CSS — and the Page button is drawn beside
 * each, so the narrow layout gets the same pairing as the wide one.
 *
 * **The ad id is the ownership.** The page lists only the seller's own ads, so
 * `data-ad-id` on a row there needs no further proof (the glossary's
 * **Ownership detection** stays open for every other page).
 *
 * **Anchored on attributes before class names.** `data-testid` and `data-ad-id`
 * are what Marktplaats's own tests and handlers read, so they move less than
 * the CSS-module classes beside them; the class is the fallback. Nothing found
 * is an empty list, never an error: a page we cannot read gets no button rather
 * than a broken one (T41).
 */
export interface Slot {
  listingId: string;
  /** The wide-screen *Sneller verkopen* button; the Page button goes above it. */
  desktop: HTMLElement | null;
  /** The narrow-screen *Sneller verkopen* link; the compact one goes before it. */
  mobile: HTMLElement | null;
  /** The whole row, which fades once its ad has been reposted. */
  row: HTMLElement | null;
}

/** Ordered: the first strategy that finds anything is the one used. */
const STRATEGIES = ['[data-testid="buy-feature-button"][data-ad-id]', ".opvallen-link[data-ad-id]"];

/** Marktplaats's item ids — the same ones `relist` takes. */
const LISTING_ID = /^m\d+$/;

export function findSlots(root: ParentNode): Slot[] {
  for (const selector of STRATEGIES) {
    const found = root.querySelectorAll<HTMLElement>(selector);
    if (found.length > 0) return group(found);
  }
  return [];
}

function group(controls: Iterable<HTMLElement>): Slot[] {
  const byId = new Map<string, Slot>();
  for (const control of controls) {
    const listingId = control.getAttribute("data-ad-id") ?? "";
    if (!LISTING_ID.test(listingId)) continue;
    const slot = byId.get(listingId) ?? { listingId, desktop: null, mobile: null, row: rowOf(control) };
    if (isLink(control)) slot.mobile ??= control;
    else slot.desktop ??= control;
    byId.set(listingId, slot);
  }
  return [...byId.values()];
}

function isLink(control: HTMLElement): boolean {
  return (
    control.classList.contains("hz-Link") ||
    control.getAttribute("role") === "link" ||
    [...control.classList].some((name) => name.includes("sellFasterMobile"))
  );
}

function rowOf(control: HTMLElement): HTMLElement | null {
  return control.closest<HTMLElement>(".cells") ?? control.closest<HTMLElement>("li, tr, article");
}
