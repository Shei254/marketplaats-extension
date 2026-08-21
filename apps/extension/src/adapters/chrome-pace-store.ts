import type { PaceMemory } from "../domain/relist-pace";

/**
 * The real {@link PaceMemory}: one key in `chrome.storage.local`, beside the
 * session and the relist snapshots.
 *
 * It is here rather than in a variable because an MV3 worker does not live long
 * enough to remember anything (T46, #54) — see `RelistPacer`. And it is read back
 * **checked**: storage outlives the code that wrote it, and under ADR-0007 the
 * user can write it themselves, so anything that is not a finite number is
 * answered as "no deadline" rather than as `NaN` milliseconds of waiting.
 */
const STORAGE_KEY = "relistPace";

export class ChromePaceStore implements PaceMemory {
  async read(): Promise<number | null> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored[STORAGE_KEY];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  async write(nextAllowedAt: number): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: nextAllowedAt });
  }
}
