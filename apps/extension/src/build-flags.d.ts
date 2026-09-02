/**
 * Build-time constants substituted by esbuild's `define` (scripts/build.mjs) and
 * by vitest's. Never read at runtime, never assigned.
 *
 * True only in `npm run build:dev`. Guard anything that must not reach a
 * published build with it — see the service worker's manual test hooks. What the
 * default build does with the false branch, and why that takes more than
 * `define`, is scripts/build.mjs's docstring.
 */
declare const __DEV__: boolean;

/**
 * The product's name, from the root `brand.json` (T48, #78) — the same file the
 * manifest and `popup.html` take theirs from, substituted rather than imported so
 * that a rename stays one edit and a rebuild.
 *
 * Defined for the popup, which draws the name in its header. The templated
 * `{{brand.name}}` tokens cannot reach here: those are resolved in HTML and JSON
 * text, and this is a bundle.
 */
declare const __BRAND_NAME__: string;

/**
 * The version of this build, from `public/manifest.template.json` — the number
 * Chrome shows on the extensions page and the one the Web Store rolls out, which
 * is the only version a user can do anything about.
 *
 * It travels to our API on every call, so the backend can say "the build you are
 * running must stop" (T43, #52). Substituted rather than read from
 * `chrome.runtime.getManifest()` for the reason `__BRAND_NAME__` is: the value is
 * fixed at build time, and a bundle that reached for a Chrome API to learn its own
 * version would be one the tests could not run without a browser.
 */
declare const __CLIENT_VERSION__: string;

/**
 * Where our own API is, for this build — from the root `deployment.json` in
 * `npm run build`, and from the local stack in `npm run build:dev` (T56, #87,
 * ADR-0024).
 *
 * Substituted rather than fetched because it **cannot** be fetched: the served
 * client-configuration document is requested from this very address, so an
 * extension that does not already have it cannot ask for it.
 * `scripts/deployment.mjs` carries the argument in full, along with every check
 * that stops a build from shipping an address no installed extension could reach.
 */
declare const __API_BASE_URL__: string;

/**
 * And which Keycloak realm it signs into, from the same file and the same split.
 *
 * Substituted for a different reason than the one above, and the difference is
 * order rather than addressing: signing in is what produces the token every API
 * call carries, so it precedes the first fetch of that document — and a document
 * arriving after sign-in cannot have said which realm to sign into.
 */
declare const __AUTH_ISSUER__: string;
