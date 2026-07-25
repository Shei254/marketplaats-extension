import { ChromeSnapshotStore } from "../adapters/chrome-snapshot-store";
import { RelayMarktplaatsClient } from "../adapters/relay-marktplaats-client";
import { RelistOrchestrator } from "../domain/relist-orchestrator";
import {
  loadEndpointConfig,
  saveEndpointConfig,
  type EndpointConfig,
} from "../shared/endpoint-config";

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
 * Dev-only manual test hooks. Open the service-worker console
 * (chrome://extensions → this extension → "Inspect views: service worker") with
 * a marktplaats.nl tab open. Configure endpoints once, then relist:
 *   await __setEndpoints({ listMyAds: "…", deleteAd: "/api/ads/:id", … })
 *   await __relist("<throwaway-ad-id>")
 * (Endpoints can also be set in the Options page.)
 */
Object.assign(globalThis, {
  __relist: (listingId: string) => orchestrator.relist(listingId),
  __retry: (listingId: string) => orchestrator.retry(listingId),
  __resume: () => orchestrator.resumeAll(),
  __getEndpoints: () => loadEndpointConfig(),
  __setEndpoints: (partial: Partial<EndpointConfig>) =>
    loadEndpointConfig().then((current) => saveEndpointConfig({ ...current, ...partial })),
});
