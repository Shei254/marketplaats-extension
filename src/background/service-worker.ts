import { MarktplaatsHttpClient } from "../adapters/marktplaats-http-client";
import { ChromeSnapshotStore } from "../adapters/chrome-snapshot-store";
import { RelistOrchestrator } from "../domain/relist-orchestrator";

/**
 * MV3 background service worker. On startup it asks the orchestrator to resume any
 * relist interrupted mid-flight (delete done, re-create not) so a listing is never
 * left missing (ADR-0003). Resume is a no-op until the real MarktplaatsClient lands
 * (issues #2/#3/#4); the SpikePendingError is swallowed so startup stays clean.
 */
const orchestrator = new RelistOrchestrator(
  new MarktplaatsHttpClient(),
  new ChromeSnapshotStore(),
);

chrome.runtime.onStartup.addListener(() => {
  void resumeInterruptedRelists();
});

chrome.runtime.onInstalled.addListener(() => {
  void resumeInterruptedRelists();
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
