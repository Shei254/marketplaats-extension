import { ChromeAuthFlow } from "../adapters/chrome-auth-flow";
import { ChromeBatchAlarm, isBatchAlarm } from "../adapters/chrome-batch-alarm";
import { ChromeBatchStore } from "../adapters/chrome-batch-store";
import { ChromeToolbarBadge } from "../adapters/chrome-toolbar-badge";
import { ChromeSessionStore } from "../adapters/chrome-session-store";
import { ChromePaceStore } from "../adapters/chrome-pace-store";
import { ChromeSnapshotStore } from "../adapters/chrome-snapshot-store";
import { RelayMarktplaatsClient } from "../adapters/relay-marktplaats-client";
import { ClientConfigFetcher } from "../api/client-config";
import { MprelistApi } from "../api/display-state";
import { RelistAuthorizations } from "../api/relist-authorizations";
import { Subscribing } from "../api/subscribing";
import { Authenticator } from "../auth/authenticator";
import { toWireError } from "../content/messages";
import { RelistOrchestrator } from "../domain/relist-orchestrator";
import { ASSUMED_RAILS, type BatchShape } from "../domain/batch-estimate";
import { BULK_PACE, HUMAN_PACE, RelistPacer, type PacingWindow } from "../domain/relist-pace";
import { BatchRunner } from "./batch-runner";
import type { DevHook, DevHookName } from "./dev-hooks";
import { openStripePage } from "./stripe-tab";
import { loadEndpointConfig, saveEndpointOverrides } from "../shared/endpoint-config";
import { readServedConfig } from "../shared/served-config";
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

/**
 * What can be bought, buying it, and managing what was bought (T52, #83). The
 * same token as everything else, and here for the same reason `api` is: the popup
 * that starts a Checkout is destroyed by the tab that Checkout opens, so the call
 * cannot be held there.
 */
const subscribing = new Subscribing({ tokens: authenticator });

/**
 * What the extension should do differently from what it was built to do (T27,
 * #36; ADR-0013). Asked on every wake and throttled by what is already stored,
 * which is the only place a worker can keep "have I asked recently" — it has no
 * memory of its last wake.
 *
 * **Nothing awaits it.** It is not on the path to anything: the document it
 * fetches is read out of storage by whoever needs it, whenever they next need it,
 * and a worker that dies before this settles has cost the freshness of a config
 * and nothing else. Awaiting it here would make a `GET` to our API the first
 * thing that has to succeed before a message can be answered, which is precisely
 * the failure mode ADR-0013 promises this does not add.
 */
const clientConfig = new ClientConfigFetcher({ tokens: authenticator });
void clientConfig.refreshIfStale().catch((error) => {
  console.warn("[config] refresh skipped", describe(error));
});

/**
 * The human-shaped gap between relists (T46, #54), now read at the moment it is
 * needed rather than fixed when this worker woke — this is the one line that
 * ticket left for #36 to change, and nothing in `relist-pace.ts` changed with it
 * beyond accepting a source.
 *
 * `HUMAN_PACE` is the fallback and stays the answer for every deployment where
 * nobody has overridden anything, which is all of them on a normal day.
 */
const pace = new RelistPacer(new ChromePaceStore(), servedPace);

/**
 * The gap inside a run (T68, #147) — the same store and the same deadline as
 * `pace` above, drawn from a window of its own.
 *
 * **One memory and two windows**, deliberately: a single repost that follows a
 * batch ad has to see the deadline that ad wrote, and a batch ad that follows a
 * single repost has to wait out that one. Two stores would let the two paths pace
 * each other out of existence, which is the failure ADR-0008 is about and would be
 * invisible in every test that ran one path at a time.
 */
const bulkPace = new RelistPacer(new ChromePaceStore(), servedBulkPace);

async function servedPace(): Promise<PacingWindow> {
  return (await readServedConfig())?.config.pacing ?? HUMAN_PACE;
}

async function servedBulkPace(): Promise<PacingWindow> {
  return (await readServedConfig())?.config.bulkPacing ?? BULK_PACE;
}

/**
 * The two numbers the popup turns into "about two hours" beside a selection.
 *
 * Read here rather than in the popup because the served document is in
 * `chrome.storage.local`, which that surface deliberately does not touch — and
 * both halves come out of the same read, so an estimate is never a served gap
 * against built-in rails.
 *
 * Falling back to what this build ships with is the ordinary case and not a
 * failure: `rails` gates nothing, so a client that has never fetched a document
 * quotes its own numbers and is wrong only about a sentence.
 */
async function servedBatchShape(): Promise<BatchShape> {
  const served = (await readServedConfig())?.config;
  return { gap: served?.bulkPacing ?? BULK_PACE, rails: served?.rails ?? ASSUMED_RAILS };
}

const orchestrator = new RelistOrchestrator(
  new RelayMarktplaatsClient(),
  new ChromeSnapshotStore(),
  // The gate (T26, #35). The orchestrator authorizes before it captures and
  // reports after it finishes, and this is the only thing in the extension that
  // may say "proceed".
  new RelistAuthorizations({ tokens: authenticator }),
  pace,
  bulkPace,
);

/**
 * The batch queue, owned here because it has to outlive both the popup that
 * started it and this worker (T68, #147; ADR-0025).
 */
const batch = new BatchRunner({
  store: new ChromeBatchStore(),
  relisting: orchestrator,
  pace: bulkPace,
  alarms: new ChromeBatchAlarm(),
  badge: new ChromeToolbarBadge(),
});

/**
 * The one wake-up a run has between two ads. Named, so a future alarm belonging to
 * something else is not answered as this one.
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (isBatchAlarm(alarm)) void batch.onAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  // The order is a statement rather than a coincidence: a batch is **dropped** on
  // a browser restart (ADR-0025) and an interrupted relist is **resumed** on one
  // (ADR-0003), and they are opposite because one initiates a delete and the other
  // finishes putting an ad back. Dropping first is what makes sure the queue is
  // stopped before anything else in this worker starts doing relists.
  void batch.onBrowserStartup().then(resumeInterruptedRelists);
});
chrome.runtime.onInstalled.addListener(() => {
  void batch.onBrowserStartup().then(resumeInterruptedRelists);
});

/**
 * And on every ordinary wake, the run gets its alarm back if it has lost one — an
 * extension update clears alarms, and a worker can be killed between writing a run
 * and asking to be woken for it. Nothing to await: a batch is not on the path to
 * anything a message asks for.
 */
void batch.ensureScheduled().catch((error: unknown) => {
  console.warn("[batch] could not be rescheduled", describe(error));
});

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
    case "pace":
      return pace.msBeforeNextRelist();
    case "start-batch":
      return batch.start(request.listingIds);
    case "batch-state":
      return batch.state();
    case "stop-batch":
      return batch.stop();
    case "dismiss-batch":
      return batch.dismiss().then(() => null);
    case "batch-shape":
      return servedBatchShape();
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
    case "search-ads":
      return orchestrator.searchAds(request.query);
    case "plans":
      return subscribing.plans();
    case "checkout":
      return openStripePage(subscribing.checkout(request.tierCode, request.interval), inANewTab);
    case "portal":
      return openStripePage(subscribing.portal(), inANewTab);
  }
}

/**
 * The one line of Chrome that hand-off needs. `chrome.tabs.create` wants no
 * `tabs` permission — that one gates *reading* a tab's url and title, which
 * nothing here does.
 */
const inANewTab = (url: string): Promise<unknown> => chrome.tabs.create({ url });

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
 *   await __clientConfig()                       // asks the API for the served document
 *
 * `__setEndpoints` outlives the Options page it duplicated (ADR-0013) and now
 * outranks the served config too (T27, #36): it is a tester holding a path still
 * while they work it out, and a document arriving remotely mid-session must not
 * undo that. The rest are live-test drivers — docs/live-testing.md and the M7
 * spikes (#46–#48) drive the real site through them.
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
    __searchAds: (query: string) => orchestrator.searchAds(query),
    /**
     * A run started from the console, which is how slice 6 of the click-through
     * is walked without a popup in the way — and the only way to start one for
     * more ads than a tier's `upTo`, since the popup will not.
     */
    __startBatch: (listingIds: string[]) => batch.start(listingIds),
    __batchState: () => batch.state(),
    __stopBatch: () => batch.stop(),
    __getEndpoints: loadEndpointConfig,
    __setEndpoints: saveEndpointOverrides,
    /**
     * Asks the API now, ignoring the fifteen-minute throttle — a tester who has
     * just deployed a document wants to see it, not to wait out a window whose
     * whole purpose is to keep ordinary wakes cheap.
     */
    __clientConfig: () => clientConfig.refresh(),
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
    __plans: () => subscribing.plans(),
    /**
     * Opens a real Stripe Checkout tab for a tier code, which is the one hook
     * here that can lead to money moving — in test mode, against `4242…`, which
     * is what slice C step 4 walks.
     */
    __checkout: (tierCode: string, interval: string) => subscribing.checkout(tierCode, interval),
    __portal: () => subscribing.portal(),
  };
  Object.assign(globalThis, hooks);
}
