/**
 * The whole route table of `apps/web`, as a function of the path and nothing else
 * (T50, #81).
 *
 * Pure, so what the site shows at a URL is decided somewhere a test can reach
 * without a browser — the same split the popup has between `screen.ts` and
 * `screens.tsx`. `Site.tsx` renders what this returns.
 *
 * **Five public paths, and three of them are held elsewhere as well.** `/success`
 * and `/cancel` are what the Checkout session (T19, #29) is created with and
 * `/billing` is where the Stripe Customer Portal (T21, #31) returns a browser, so
 * renaming one here renames it in a Stripe API call too — which is why they are
 * exported rather than spelled again at the call site. `/privacy` is the URL the
 * Chrome Web Store listing carries (T58, #89): once that listing is live the
 * address is published in a place we do not control, so it is one to choose and
 * then leave alone.
 *
 * `/admin` is T54 (#85) and adds an entry here. Everything else — including `/` —
 * is `not-found` on purpose: there is no landing page designed on the canvas, and
 * inventing one is a decision for the ticket that also writes the Web Store
 * listing.
 */
export type Page = "success" | "cancel" | "billing" | "privacy" | "terms" | "not-found";

/** Every page that has an address of its own — which is every page but the fallback. */
type Routable = Exclude<Page, "not-found">;

/**
 * Every address this site answers. `apps/api` builds `success_url`, `cancel_url`
 * and the Portal's `return_url` from its own copy of the first three, since it is
 * Java and this is not — one copy each side of a boundary with no shared anything,
 * held together by `WebPages` there and by this table here.
 *
 * `satisfies` rather than a cast, so the table and the union are held to each
 * other in both directions: a page added above without a path here does not
 * compile, and neither does a path for a page that does not exist.
 */
export const PATHS = {
  success: "/success",
  cancel: "/cancel",
  billing: "/billing",
  privacy: "/privacy",
  terms: "/terms",
} as const satisfies Record<Routable, string>;

/**
 * The two long-form documents, which are laid out as documents rather than as the
 * one centred message the other pages are (T36, #45).
 *
 * Here rather than as a check on the page name at the one call site, because it is
 * a fact about the pages and there will be more of them — a cookie notice, an
 * imprint — the day a jurisdiction asks for one.
 */
export function isDocument(page: Page): boolean {
  return page === "privacy" || page === "terms";
}

const BY_PATH = new Map<string, Page>(
  (Object.entries(PATHS) as [Routable, string][]).map(([page, path]) => [path, page]),
);

/**
 * One path, one page. Total: an address nobody claimed is a page rather than a
 * blank screen, because the one visitor most likely to mistype is somebody who
 * just paid.
 *
 * A trailing slash is the same address — hosts and browsers add one — and the
 * query string is not part of `location.pathname`, so Stripe's own
 * `?session_id=…` never reaches this.
 */
export function pageFor(pathname: string): Page {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return BY_PATH.get(trimmed) ?? "not-found";
}
