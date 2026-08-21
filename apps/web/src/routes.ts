/**
 * The whole route table of `apps/web`, as a function of the path and nothing else
 * (T50, #81).
 *
 * Pure, so what the site shows at a URL is decided somewhere a test can reach
 * without a browser — the same split the popup has between `screen.ts` and
 * `screens.tsx`. `Site.tsx` renders what this returns.
 *
 * **Two public paths today, and Stripe holds copies of both.** `/success` and
 * `/cancel` are what the Checkout session (T19, #29) is created with, so renaming
 * one here renames it in a Stripe API call as well — which is why they are
 * exported rather than spelled again at the call site.
 *
 * Privacy and terms are T36 (#45) and `/admin` is T54 (#85); both add entries
 * here. Everything else — including `/` — is `not-found` on purpose: there is no
 * landing page designed on the canvas, and inventing one is a decision for the
 * ticket that also decides the Web Store listing (T58, #89).
 */
export type Page = "success" | "cancel" | "not-found";

/** Every page that has an address of its own — which is every page but the fallback. */
type Routable = Exclude<Page, "not-found">;

/**
 * The paths Stripe redirects to. `apps/api` builds `success_url`/`cancel_url` from
 * its own copy, since it is Java and this is not.
 *
 * `satisfies` rather than a cast, so the table and the union are held to each
 * other in both directions: a page added above without a path here does not
 * compile, and neither does a path for a page that does not exist.
 */
export const PATHS = {
  success: "/success",
  cancel: "/cancel",
} as const satisfies Record<Routable, string>;

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
