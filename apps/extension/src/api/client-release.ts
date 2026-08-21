/**
 * Which build is calling, and the header it says so in (T43, #52).
 *
 * **The two ship together and are useless apart.** A version with no surface
 * cannot be compared against anything, and this API has more than one client — so
 * one header carries both: `X-Mprelist-Client: extension/0.0.1`.
 *
 * **Why the extension sends it at all.** Releases here take days: the Web Store
 * reviews them, and a user who has turned auto-update off never takes one. The API
 * ships in minutes. So several builds are always calling one backend, and the API
 * needs a way to say "the build you are running must stop" — which it cannot say
 * to a build that never identified itself. That is the whole reason this is here
 * before it is needed: **a lever added later cannot reach the releases that
 * predate it**, so the first published build has to already carry the header.
 *
 * It is identification, not authentication. Nothing about it is a boundary: a
 * client that wanted to lie about its version could, and one modified enough to
 * bother is not running this code anyway.
 */
export const CLIENT_HEADER = "X-Mprelist-Client";

/**
 * This build, as the header names it. `__CLIENT_VERSION__` is the manifest's own
 * version, substituted at build time (`scripts/build.mjs`) — the number Chrome
 * shows and the Web Store rolls out, which is the only version a user can act on.
 *
 * `extension` is spelled here and, separately, in the API's own configuration. Two
 * copies of one word held together by a test at each end, rather than a shared
 * constant across a Java/TypeScript boundary that has no shared anything.
 */
export const CLIENT_RELEASE = `extension/${__CLIENT_VERSION__}`;

/** The header, ready to spread into a `fetch`'s. One place builds it, so both call sites agree. */
export function clientHeaders(): Record<string, string> {
  return { [CLIENT_HEADER]: CLIENT_RELEASE };
}
