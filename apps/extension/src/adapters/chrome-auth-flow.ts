import { classifyLaunchFailure, type BrowserAuthFlow, type LaunchOutcome } from "../auth/browser-flow";

/**
 * The real `BrowserAuthFlow`: `chrome.identity.launchWebAuthFlow` (ADR-0010).
 *
 * Thin on purpose. Everything about *what* to launch is the authenticator's, and
 * the one judgement here — which kind of failure Chrome is reporting — is
 * `classifyLaunchFailure`, a pure function with its own test, because this class
 * is a system boundary and is not unit-tested (as `ChromeSnapshotStore` is not).
 *
 * Requires the `identity` permission, which `public/manifest.template.json`
 * declares and `src/auth/auth-config.test.ts` asserts is still declared: without
 * it `chrome.identity` is simply undefined at the moment somebody clicks sign in.
 */
export class ChromeAuthFlow implements BrowserAuthFlow {
  redirectUri(): string {
    return chrome.identity.getRedirectURL();
  }

  async launch(url: string, options: { interactive: boolean }): Promise<LaunchOutcome> {
    try {
      const redirectedTo = await chrome.identity.launchWebAuthFlow({
        url,
        interactive: options.interactive,
      });

      // Chrome resolves with nothing rather than rejecting in some cancellation
      // paths. Answering `ok: true` with an empty URL would send an empty string
      // to be parsed for a code, so it is a failure here.
      if (!redirectedTo) {
        return { ok: false, reason: "cancelled", message: "The sign-in window closed." };
      }
      return { ok: true, redirectedTo };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: classifyLaunchFailure(message), message };
    }
  }
}
