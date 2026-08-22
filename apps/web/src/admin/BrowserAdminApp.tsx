import type { JSX } from "react";

import { ADMIN_PATH, isAdminPath } from "../routes";
import { AdminApp } from "./AdminApp";

/**
 * `AdminApp` with the browser wired into it (T54, #85).
 *
 * **It lives in `src/admin/` because of what it touches**, not because of what it
 * renders. `no-identity.test.ts` walks every source file outside this directory
 * and asserts that none of them names `sessionStorage`, `fetch` or a cookie — the
 * claim ADR-0017 makes about the public bundle, checked over the source rather
 * than over a screen. This is the one file that has to break that rule, so this is
 * the directory it belongs in, and `main.tsx` stays a decision about which surface
 * to render rather than a place identity leaks into.
 *
 * **`sessionStorage`, not `localStorage`.** What is stored is the PKCE verifier and
 * `state` for the seconds between leaving for Keycloak and coming back; a second
 * tab has its own sign-in and must not see this one's, and nothing here should
 * outlive the tab that started it. The token itself is never stored at all — see
 * `admin-session.ts`.
 */
export function BrowserAdminApp(): JSX.Element {
  return (
    <AdminApp
      storage={sessionStorage}
      search={location.search}
      // Where to come back to. A redirect from Keycloak lands on `/` — the only
      // URI the realm registers — so the path is only ever read as `/admin` when
      // that is genuinely where somebody started.
      path={isAdminPath(location.pathname) ? location.pathname : ADMIN_PATH}
      navigate={(url) => location.assign(url)}
      replaceUrl={(url) => history.replaceState(null, "", url)}
    />
  );
}

/**
 * Whether this page load is a redirect coming back from Keycloak.
 *
 * Read from the query rather than the path because the realm decides where the
 * redirect lands and it is not `/admin` — so without this, an arrival would render
 * the public not-found page with an authorization code sitting in the address bar.
 */
export function returningFromSignIn(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has("code") || params.has("error");
}
