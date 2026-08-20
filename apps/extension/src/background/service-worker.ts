import { ChromeAuthFlow } from "../adapters/chrome-auth-flow";
import { ChromeSessionStore } from "../adapters/chrome-session-store";
import { ChromeSnapshotStore } from "../adapters/chrome-snapshot-store";
import { RelayMarktplaatsClient } from "../adapters/relay-marktplaats-client";
import { MprelistApi } from "../api/display-state";
import { RelistAuthorizations } from "../api/relist-authorizations";
import { Authenticator } from "../auth/authenticator";
import { toWireError } from "../content/messages";
import { RelistOrchestrator } from "../domain/relist-orchestrator";
import type { DevHook, DevHookName } from "./dev-hooks";
import { loadEndpointConfig, saveEndpointOverrides } from "../shared/endpoint-config";
import {
  toWireOutcome,
  type BackgroundAnswers,
  type BackgroundRequest,
  type BackgroundResponse,
} from "./messages";

/**
 * MV3 background service worker. Owns the orchestrator wired to the real relay
 * client + chrome.storage snapshot store. On startup it resumes any relist
 * interrupted mid-flight so a listing is never left missing (ADR-0003); resume
 * is a no-op (swallowed) when no marktplaats.nl tab is open or endpoints are
 * still pending the spike.
 *
 * Everything here is constructed at module scope and in dependency order, which
 * `const` makes load-bearing rather than tidy: a worker that built the
 * orchestrator first would reach a `TemporalDeadZone` on the authenticator it
 * needs, on every wake, before any message was handled.
 */

/**
 * Sign-in lives here rather than in the popup because `launchWebAuthFlow` opens a
 * window, and the popup is destroyed the moment that window takes focus (ADR-0010,
 * T23). Constructing it costs nothing: neither adapter touches `chrome.identity`
 * or storage until it is called.
 */
const authenticator = new Authenticator({
  flow: new ChromeAuthFlow(),
  store: new ChromeSessionStore(),
});

/**
 * Our own API, asked with whatever token the authenticator can produce at the
 * moment of the call (T24, #33). It lives here rather than in the popup because
 * the token does: a popup holding one would be a second copy to keep fresh, and
 * the cached snapshot the injected buttons will read (#51) has to be somewhere
 * that outlives a popup being closed.
 */
const api = new MprelistApi({ tokens: authenticator });

const orchestrator = new RelistOrchestrator(
  new RelayMarktplaatsClient(),
  new ChromeSnapshotStore(),
  // The gate (T26, #35). The orchestrator authorizes before it captures and
  // reports after it finishes, and this is the only thing in the extension that
  // may say "proceed".
  new RelistAuthorizations({ tokens: authenticator }),
);

chrome.runtime.onStartup.addListener(() => void resumeInterruptedRelists());
chrome.runtime.onInstalled.addListener(() => void resumeInterruptedRelists());

async function resumeInterruptedRelists(): Promise<void> {
  try {
    const outcomes = await orchestrator.resumeAll();
    if (outcomes.length > 0) {
      console.info(`[relist] resumed ${outcomes.length} interrupted relist(s)`, outcomes);
    }
  } catch (error) {
    console.warn("[relist] resume skipped", error);
  }
}

/**
 * Requests from the popup (and, later, the injected page icons). Run here rather
 * than in the caller so closing the popup mid-relist cannot strand an ad between
 * the delete and the re-create — and so a sign-in survives the popup that asked
 * for it being closed by the window it opened.
 */
chrome.runtime.onMessage.addListener(
  (
    request: BackgroundRequest,
    _sender,
    sendResponse: (response: BackgroundResponse) => void,
  ) => {
    answer(request)
      .then((value) => sendResponse({ ok: true, answer: value }))
      .catch((error) => {
        // The message, not the error: a sign-in failure's cause can carry a URL
        // with a code in it, and this line ends up in a console somebody pastes
        // into an issue.
        console.error(`[worker] ${request.kind} failed`, describe(error));
        sendResponse({ ok: false, error: toWireError(error) });
      });
    return true; // Keep the channel open for the async response.
  },
);

function answer(
  request: BackgroundRequest,
): Promise<BackgroundAnswers[BackgroundRequest["kind"]]> {
  switch (request.kind) {
    case "relist":
      return orchestrator.relist(request.listingId).then(toWireOutcome);
    case "retry":
      return orchestrator.retry(request.listingId).then(toWireOutcome);
    case "sign-in":
      return authenticator.signIn();
    case "sign-out":
      return authenticator.signOut();
    case "auth-state":
      return authenticator.state();
    case "display-state":
      return api.displayState();
    case "list-ads":
      return orchestrator.listAds();
  }
}

/** An error's message and nothing else — never a token, never a redirect URL. */
function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Manual test hooks, present only in a `npm run build:dev` build. The default
 * build drops this block rather than shipping globals that can delete a user's
 * ad; how that elimination is achieved is scripts/build.mjs's docstring.
 *
 * Open the service-worker console (chrome://extensions → this extension →
 * "Inspect views: service worker") with a marktplaats.nl tab open:
 *   await __getEndpoints()                       // what the layer will call
 *   await __signIn()                             // opens the real Keycloak window
 *   await __accessToken()                        // a token to curl the API with
 *   await __apiMe()                              // what the popup renders
 *   await __relist("<throwaway-ad-id>")
 *
 * `__setEndpoints` outlives the Options page it duplicated (ADR-0013): the
 * backend-served config that supersedes both is #36 and does not exist yet, so
 * without it a Marktplaats-side path change means editing source and rebuilding.
 * The rest are live-test drivers — docs/live-testing.md and the M7 spikes
 * (#46–#48) drive the real site through them.
 *
 * The map is total over `DevHookName` (./dev-hooks), so a hook added here without
 * a name there does not compile — scripts/build.test.ts asserts against that same
 * list, and a hook it does not know about is a hook it cannot prove absent from
 * the shipped bundle.
 */
if (__DEV__) {
  const hooks: Record<DevHookName, DevHook> = {
    __relist: (listingId: string) => orchestrator.relist(listingId),
    __captureAd: (listingId: string) => orchestrator.captureAd(listingId),
    __listAds: () => orchestrator.listAds(),
    __retry: (listingId: string) => orchestrator.retry(listingId),
    __resume: () => orchestrator.resumeAll(),
    __searchAd: (adName: string) => orchestrator.searchAd(adName),
    __getEndpoints: loadEndpointConfig,
    __setEndpoints: saveEndpointOverrides,
    __signIn: () => authenticator.signIn(),
    __signOut: () => authenticator.signOut(),
    __authState: () => authenticator.state(),
    /**
     * Hands back a usable access token, refreshing first if the one held is past
     * it — which is what makes `curl -H "Authorization: Bearer …" …/api/me`
     * possible before any client calls the API for itself (T24, #33).
     *
     * It is the one hook that answers with a secret, and that is a different
     * thing from the rule everything else here keeps: nothing *logs* a token
     * unbidden, so a console pasted into an issue carries none. This one has to
     * be asked. It exists only in a `build:dev` bundle, which
     * `scripts/build.test.ts` asserts against the emitted bytes.
     */
    __accessToken: () => authenticator.accessToken(),
    __apiMe: () => api.displayState(),
  };
  Object.assign(globalThis, hooks);
}
