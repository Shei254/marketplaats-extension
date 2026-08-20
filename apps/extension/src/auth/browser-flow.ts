/**
 * System boundary: the browser window an OAuth redirect happens in.
 *
 * The real implementation is `chrome.identity.launchWebAuthFlow`
 * (src/adapters/chrome-auth-flow.ts); the authenticator is tested against a fake,
 * the same arrangement `SnapshotStore` and `MarktplaatsClient` have.
 *
 * The port answers with a result rather than throwing, because the two ways it
 * fails are not the same event: a user who closed the window has done something
 * ordinary, and a login page that would not load has not. Which of the two Chrome
 * means is only legible from the message it rejects with, so that reading is
 * `classifyLaunchFailure` below — a pure function with a test, rather than a
 * string comparison buried in an adapter nothing exercises.
 */
export type LaunchOutcome =
  | { ok: true; redirectedTo: string }
  | { ok: false; reason: LaunchFailure; message: string };

export type LaunchFailure = "cancelled" | "failed";

export interface BrowserAuthFlow {
  /**
   * The URI Chrome intercepts instead of navigating to —
   * `https://<extension-id>.chromiumapp.org/`, which is what the realm registers.
   * Asked of Chrome rather than composed here: the id is Chrome's answer to give
   * (T44, #13), and a second derivation of it is a second thing to be wrong.
   */
  redirectUri(): string;

  /** Drive `url`, and answer with the redirect it ended at. */
  launch(url: string, options: { interactive: boolean }): Promise<LaunchOutcome>;
}

/**
 * Which kind of failure Chrome is reporting.
 *
 * `chrome.identity` has no error codes — it rejects with an English sentence, so
 * these are the sentences. They come from Chromium's `identity_api` strings, and
 * the list is matched loosely (case-insensitive substrings) because the wording
 * has moved between versions and the consequence of a miss is only that a user who
 * closed a window is told something went wrong.
 *
 * Anything unrecognised is `failed`, which is the fail-closed direction: a real
 * failure reported as a cancellation is a sign-in that silently does nothing.
 */
const CANCELLATIONS = [
  "the user did not approve access", // closed the window, or refused consent
  "user cancelled",
  "user closed the window",
  "canceled by user",
];

export function classifyLaunchFailure(message: string): LaunchFailure {
  const text = message.toLowerCase();
  return CANCELLATIONS.some((phrase) => text.includes(phrase)) ? "cancelled" : "failed";
}
