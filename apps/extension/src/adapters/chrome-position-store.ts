import { readPosition, type SavedPosition } from "../popup/ad-pages";

/**
 * The **Saved position**: one key in `chrome.storage.local`.
 *
 * It only saves a seller some clicks, so failing to read or write it is never
 * reported: the list opens at the top, which is what it did before this existed.
 *
 * Not unit-tested beyond `readPosition`: chrome.storage is a system boundary.
 */
const STORAGE_KEY = "adListPosition";

export async function readSavedPosition(): Promise<SavedPosition | null> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return readPosition(stored[STORAGE_KEY]);
  } catch {
    return null;
  }
}

export async function writeSavedPosition(position: SavedPosition): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: position }).catch(() => undefined);
}

export async function clearSavedPosition(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY).catch(() => undefined);
}
