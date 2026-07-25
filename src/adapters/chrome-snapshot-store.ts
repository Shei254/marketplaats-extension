import type { SnapshotStore } from "../domain/snapshot-store";
import type { AdSnapshot, Photo } from "../domain/types";

/**
 * Real SnapshotStore over chrome.storage.local (ADR-0003). Photo bytes are base64
 * encoded because chrome.storage serializes to a JSON-like form that does not
 * round-trip Uint8Array. Requires the "storage" and "unlimitedStorage" permissions
 * (ADR-0003 — photo blobs can exceed the default quota).
 *
 * Not unit-tested: chrome.storage is a system boundary, verified by manual QA.
 */
const KEY_PREFIX = "snapshot:";

interface StoredPhoto {
  filename: string;
  mimeType: string;
  base64: string;
}

interface StoredSnapshot {
  listingId: string;
  draft: AdSnapshot["draft"];
  photos: StoredPhoto[];
  phase: AdSnapshot["phase"];
  createdAt: number;
}

function keyFor(listingId: string): string {
  return `${KEY_PREFIX}${listingId}`;
}

function toStored(snapshot: AdSnapshot): StoredSnapshot {
  return {
    ...snapshot,
    photos: snapshot.photos.map((p) => ({
      filename: p.filename,
      mimeType: p.mimeType,
      base64: bytesToBase64(p.data),
    })),
  };
}

function fromStored(stored: StoredSnapshot): AdSnapshot {
  const photos: Photo[] = stored.photos.map((p) => ({
    filename: p.filename,
    mimeType: p.mimeType,
    data: base64ToBytes(p.base64),
  }));
  return { ...stored, photos };
}

export class ChromeSnapshotStore implements SnapshotStore {
  async save(snapshot: AdSnapshot): Promise<void> {
    await chrome.storage.local.set({ [keyFor(snapshot.listingId)]: toStored(snapshot) });
  }

  async get(listingId: string): Promise<AdSnapshot | null> {
    const key = keyFor(listingId);
    const result = await chrome.storage.local.get(key);
    const stored = result[key] as StoredSnapshot | undefined;
    return stored ? fromStored(stored) : null;
  }

  async list(): Promise<AdSnapshot[]> {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([key]) => key.startsWith(KEY_PREFIX))
      .map(([, value]) => fromStored(value as StoredSnapshot));
  }

  async clear(listingId: string): Promise<void> {
    await chrome.storage.local.remove(keyFor(listingId));
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
