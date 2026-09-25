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
 * **`/admin` is deliberately not one of these.** T54 (#85) made it a *surface*
 * rather than a page: it has its own frame, its own stylesheet and the only
 * authentication in this build (ADR-0017), so it is chosen before this table is
 * consulted and `pageFor("/admin")` still answers `not-found`. What that keeps
 * true is the sentence this type is named for — every page here is public, and a
 * reader of the table cannot mistake the admin corner for one.
 *
 * **`/` is the landing page** (T58, #89), which the Web Store listing names as the
 * homepage — the same kind of published address as `/privacy`. It was `not-found`
 * until `docs/design/Landing.dc.html` decided what goes there. Everything else is
 * `not-found`.
 */
export type Page = "landing" | "success" | "cancel" | "billing" | "privacy" | "terms" | "not-found";

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
  landing: "/",
  success: "/success",
  cancel: "/cancel",
  billing: "/billing",
  privacy: "/privacy",
  terms: "/terms",
} as const satisfies Record<Routable, string>;

/**
 * The admin corner's address (T54, #85). Exported rather than spelled at the entry
 * point because two files need it and one of them is not this table's business:
 * the entry chooses the surface by it, and the sign-in remembers it as the place
 * to come back to.
 *
 * **The sign-in does not return here**, and cannot: the realm registers the origin
 * root as `mprelist-dashboard`'s redirect URI and Keycloak matches exactly, so a
 * redirect back to `/admin` is refused with a page rather than a bounce. The
 * arrival lands at `/` and rewrites the address bar to this.
 */
export const ADMIN_PATH = "/admin";

/**
 * Whether this address is the admin surface rather than a page of the public site.
 *
 * A trailing slash is the same address, like everywhere else here — a host or a
 * browser may add one, and `/admin/` reaching the not-found page would be a
 * confusing way to find that out.
 */
export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_PATH || pathname === `${ADMIN_PATH}/`;
}

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
