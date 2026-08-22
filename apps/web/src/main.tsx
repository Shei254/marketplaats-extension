import { createRoot } from "react-dom/client";

import { BrowserAdminApp, returningFromSignIn } from "./admin/BrowserAdminApp";
import { isAdminPath } from "./routes";
import { Site } from "./Site";

/**
 * The entry point, and the only file here that touches the document.
 *
 * Everything above it is a function of what it is handed — the same split the popup
 * has, where `popup-entry.tsx` is the one file that knows about Chrome. What the
 * admin surface needs from the browser is supplied one file deeper, in
 * `admin/BrowserAdminApp.tsx`, so that this one stays a decision about which
 * surface to render and `no-identity.test.ts` can keep asserting that nothing
 * outside `src/admin/` learns who anybody is.
 *
 * **Two surfaces, one build** (ADR-0017). Which one loads is decided here, before
 * the public route table is consulted, because `/admin` is not a page of that site:
 * it has its own frame, its own stylesheet and the only authentication in this
 * bundle. There is still no router — the public pages are each arrived at from
 * somewhere else, and the admin corner is one screen.
 *
 * **A sign-in coming back from Keycloak lands on `/`, not on `/admin`.** The realm
 * registers the origin root as this client's redirect URI and matches it exactly
 * (`KeycloakRealmTest` proves a path beneath it is refused), so an arrival is
 * recognised by what is in the query rather than by the path — and without that
 * second condition it would render the public not-found page with an authorization
 * code sitting in the address bar. T56 (#87) serves `/admin` from `admin.<domain>`
 * at Go-Live, whose root is exactly this.
 *
 * **Serving these paths is a deploy-time obligation** (T55, #86): one build, one
 * `index.html`, so `/success` and `/admin` both have to be answered with it rather
 * than with a 404. `vite dev` and `vite preview` already do.
 */
const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root to render into");

createRoot(root).render(
  isAdminPath(location.pathname) || returningFromSignIn(location.search) ? (
    <BrowserAdminApp />
  ) : (
    <Site pathname={location.pathname} year={new Date().getFullYear()} />
  ),
);
