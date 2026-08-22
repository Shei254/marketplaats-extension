/**
 * The names of the worker's manual test hooks — the one list, so the set cannot
 * drift from what the worker actually installs.
 *
 * `service-worker.ts` types its hook map as a *total* `Record<DevHookName, …>`,
 * which makes drift a compile error in both directions: a name added here with no
 * implementation fails to build, and an implementation whose name is not here is
 * an excess property. This is the trick `endpoint-config.ts` uses on
 * `DEFAULT_ENDPOINT_CONFIG`, for the same reason — a list restated in two places
 * is a list that will disagree.
 *
 * The stakes are specific: `scripts/build.test.ts` asserts that none of these
 * reach the production bundle, and that assertion can only cover the hooks it
 * knows about. One more hook the test had never heard of would ship, silently,
 * past a green suite. That is the failure this module exists to make impossible.
 *
 * The worker imports only the *type*, so `verbatimModuleSyntax` erases the import
 * and these strings never reach a bundle — which is what lets the production
 * assertion be a plain text search for them.
 */
export const DEV_HOOK_NAMES = [
  "__relist",
  "__captureAd",
  "__listAds",
  "__retry",
  "__resume",
  // `__searchAds`, beside `__listAds`, because since T31 (#40) it answers with the
  // same rows and the popup's search box is its real caller.
  "__searchAds",
  "__getEndpoints",
  "__setEndpoints",
  "__signIn",
  "__signOut",
  "__authState",
  "__accessToken",
  // `__apiMe` rather than `__me`: these names are asserted absent from the
  // production bundles by a text search, and a two-letter one is a search that
  // will one day match something inside a dependency and fail for the wrong
  // reason. The popup's bundle now carries React.
  "__apiMe",
  // Subscribing (T52, #83). `__checkout` and `__portal` are the two hooks here
  // that reach a live Stripe: in test mode against `4242…`, which is what the
  // click-through's slice C walks — and they answer with the URL rather than
  // opening it, since the worker's own tab-opening is the popup's path and this
  // one is a console.
  "__plans",
  "__checkout",
  "__portal",
] as const;

export type DevHookName = (typeof DEV_HOOK_NAMES)[number];

/**
 * Any callable. The hooks differ in arity and return type and are only ever
 * invoked by hand from the console, so the map constrains the *keys* and leaves
 * each signature to its own implementation.
 */
export type DevHook = (...args: never[]) => unknown;
