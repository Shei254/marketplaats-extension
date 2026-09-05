import type { BatchSession } from "../domain/batch-session";

/**
 * The real {@link BatchSession}: one key in `chrome.storage.session` (T68, #147;
 * ADR-0025).
 *
 * **`session` rather than `local`, for the one property that matters here.** The
 * session area is held in memory and emptied when the browser closes, so a key
 * that is missing *is* a browser that has just started — there is nothing to clear
 * it, and nothing that has to remember to. In `local` the marker would outlive the
 * restart it is about, and the only thing that could clear it is the startup this
 * exists to detect.
 *
 * **And it survives the worker**, which is the other half and the reason a
 * variable in `service-worker.ts` will not do: an MV3 worker is torn down about
 * thirty seconds after it goes idle, so an ordinary mid-session wake — a popup
 * asking something, an alarm advancing a run — must not read as a restart, or
 * every wake would drop the run it woke up to advance.
 *
 * An extension update empties this area too, since it goes with the extension
 * being unloaded, so an update reads here as a restart. That is the answer
 * ADR-0025 already gives an update: the queue is dropped and offered back rather
 * than picked up by something nobody asked.
 */
const STORAGE_KEY = "batchWoken";

export class ChromeBatchSession implements BatchSession {
  async claimFirstWake(): Promise<boolean> {
    const stored = await chrome.storage.session.get(STORAGE_KEY);
    if (stored[STORAGE_KEY] === true) return false;
    await chrome.storage.session.set({ [STORAGE_KEY]: true });
    return true;
  }
}
