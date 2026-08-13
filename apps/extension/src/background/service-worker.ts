import { ChromeSnapshotStore } from "../adapters/chrome-snapshot-store";
import { RelayMarktplaatsClient } from "../adapters/relay-marktplaats-client";
import { toWireError } from "../content/messages";
import { RelistOrchestrator, type RelistOutcome } from "../domain/relist-orchestrator";
import type { DevHook, DevHookName } from "./dev-hooks";
import {
  loadEndpointConfig,
  saveEndpointConfig,
  type EndpointConfig,
} from "../shared/endpoint-config";
import { toWireOutcome, type BackgroundRequest, type BackgroundResponse } from "./messages";

/**
 * MV3 background service worker. Owns the orchestrator wired to the real relay
 * client + chrome.storage snapshot store. On startup it resumes any relist
 * interrupted mid-flight so a listing is never left missing (ADR-0003); resume
 * is a no-op (swallowed) when no marktplaats.nl tab is open or endpoints are
 * still pending the spike.
 */
const orchestrator = new RelistOrchestrator(
  new RelayMarktplaatsClient(),
  new ChromeSnapshotStore(),
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
 * Relist requests from the popup (and, later, the injected page icons). Run here
 * rather than in the caller so closing the popup mid-relist cannot strand an ad
 * between the delete and the re-create.
 */
chrome.runtime.onMessage.addListener(
  (
    request: BackgroundRequest,
    _sender,
    sendResponse: (response: BackgroundResponse) => void,
  ) => {
    runRelist(request)
      .then((outcome) => sendResponse({ ok: true, outcome: toWireOutcome(outcome) }))
      .catch((error) => {
        console.error("[relist] request failed", error);
        sendResponse({ ok: false, error: toWireError(error) });
      });
    return true; // Keep the channel open for the async response.
  },
);

function runRelist(request: BackgroundRequest): Promise<RelistOutcome> {
  switch (request.kind) {
    case "relist":
      return orchestrator.relist(request.listingId);
    case "retry":
      return orchestrator.retry(request.listingId);
  }
}

/**
 * Manual test hooks, present only in a `npm run build:dev` build — `__DEV__` is
 * a build-time constant, so the default build drops this block instead of
 * shipping globals that can delete a user's ad (scripts/build.mjs).
 *
 * Open the service-worker console (chrome://extensions → this extension →
 * "Inspect views: service worker") with a marktplaats.nl tab open:
 *   await __getEndpoints()                       // what the layer will call
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
    __getEndpoints: () => loadEndpointConfig(),
    __setEndpoints: (partial: Partial<EndpointConfig>) =>
      loadEndpointConfig().then((current) => saveEndpointConfig({ ...current, ...partial })),
  };
  Object.assign(globalThis, hooks);
}
