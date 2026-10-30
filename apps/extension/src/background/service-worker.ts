import { ChromeAuthFlow } from "../adapters/chrome-auth-flow";
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
import { ChromeRetryAlarm, retryStage } from "../adapters/chrome-retry-alarm";
import { PendingRetries } from "../domain/pending-retries";
import { RelistOrchestrator, type RelistOutcome } from "../domain/relist-orchestrator";
import { HUMAN_PACE, RelistPacer, type PacingWindow } from "../domain/relist-pace";
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
 * client + chrome.storage snapshot store. Whenever a marktplaats.nl page loads it
 * resumes any relist interrupted mid-flight so a listing is never left missing
 * (ADR-0003, ADR-0039), and retries one that failed on a schedule; a resume with
 * nothing to do is one storage read.
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

async function servedPace(): Promise<PacingWindow> {
  return (await readServedConfig())?.config.pacing ?? HUMAN_PACE;
}

const orchestrator = new RelistOrchestrator(
  new RelayMarktplaatsClient(),
  new ChromeSnapshotStore(),
  // The gate (T26, #35). The orchestrator authorizes before it captures and
  // reports after it finishes, and this is the only thing in the extension that
  // may say "proceed".
  new RelistAuthorizations({ tokens: authenticator }),
  pace,
);

/**
 * When a pending repost is tried again (ADR-0039): quick retries after a failure,
 * then an alarm while a marktplaats.nl tab is open, then the next page load.
 * **Not `onStartup` or `onInstalled`** — at both of those every marktplaats.nl
 * tab is still restoring or is a **Stale tab**, and the resume could reach none.
 */
const MARKTPLAATS_TABS = "https://www.marktplaats.nl/*";

const retries = new PendingRetries({
  resume: resumeInterruptedRelists,
  pending: () => orchestrator.pendingReposts(),
  alarm: new ChromeRetryAlarm(),
  marktplaatsOpen: async () => (await chrome.tabs.query({ url: MARKTPLAATS_TABS })).length > 0,
});

chrome.alarms.onAlarm.addListener((alarm) => {
  const stage = retryStage(alarm.name);
  if (stage !== null) void retries.onAlarm(stage);
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

/** A relist the popup started that left an ad pending gets the quick retries. */
function retryIfPending(outcome: RelistOutcome): RelistOutcome {
  if (outcome.status === "failed-recoverable" || outcome.status === "unconfirmed") void retries.afterFailure();
  return outcome;
}

/**
 * Tabs a `Pagina vernieuwen` is waiting on, by tab id: each is answered by that
 * tab's `marktplaats-ready`, or gives up after `RELOAD_WAIT_MS` so the popup asks
 * for the list either way and shows whatever is true then.
 */
const reloading = new Map<number, () => void>();
const RELOAD_WAIT_MS = 15_000;

async function reloadAndWait(tabId: number): Promise<null> {
  const loaded = new Promise<void>((resolve) => {
    reloading.set(tabId, resolve);
    setTimeout(resolve, RELOAD_WAIT_MS);
  });
  await chrome.tabs.reload(tabId);
  await loaded;
  reloading.delete(tabId);
  return null;
}

function marktplaatsReady(tabId: number | undefined): Promise<null> {
  if (tabId !== undefined) reloading.get(tabId)?.();
  void retries.onReady();
  return Promise.resolve(null);
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
    sender,
    sendResponse: (response: BackgroundResponse) => void,
  ) => {
    answer(request, sender)
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

export async function syncBadge(orchestrator: RelistOrchestrator): Promise<void> {
  const waiting = (await orchestrator.pendingReposts()).filter((p) => !p.running).length;
  await chrome.action.setBadgeText({ text: waiting ? "!" : "" });
  if (waiting) await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
}

function answer(
  request: BackgroundRequest,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundAnswers[BackgroundRequest["kind"]]> {
  switch (request.kind) {
    case "relist":
      return orchestrator.relist(request.listingId).then(retryIfPending).then(toWireOutcome);
    case "retry":
      return orchestrator.retry(request.listingId).then(retryIfPending).then(toWireOutcome);
    case "pending-reposts":
      return orchestrator.pendingReposts();
    case "let-go":
      return orchestrator.letGo(request.listingId);

    case "reload-marktplaats":
      return reloadAndWait(request.tabId);
    case "marktplaats-ready":
      return marktplaatsReady(sender.tab?.id);
    case "pace":
      return pace.msBeforeNextRelist();
    case "sign-in":
      return authenticator.signIn();
    case "sign-out":
      return authenticator.signOut();
    case "auth-state":
      return authenticator.state();
    case "display-state":
      return api.displayState();
    case "list-ads":
      return orchestrator.listAdsPage(request.batchNumber, request.batchSize);
    case "search-ads":
      return orchestrator.searchAds(request.query);
    case "plans":
      return subscribing.plans();
    case "checkout":
      return openStripePage(subscribing.checkout(request.tierCode, request.interval), inANewTab);
    case "portal":
      return openStripePage(subscribing.portal(), inANewTab);
    case "relist-status":
      return Promise.resolve(orchestrator.activeRepost())
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
