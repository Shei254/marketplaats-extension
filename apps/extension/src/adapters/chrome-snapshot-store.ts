import type { SnapshotStore } from "../domain/snapshot-store";
import type { AdSnapshot, Photo, RepostRecord } from "../domain/types";
import { base64ToBytes, bytesToBase64 } from "../shared/base64";

/**
 * Real SnapshotStore over chrome.storage.local.
 *
 * A create-first record (ADR-0041) is a few ids and stored as it is. Only an
 * ADR-0003 snapshot carries photos, whose bytes are base64 encoded because
 * chrome.storage serializes to a JSON-like form that does not round-trip
 * Uint8Array — and those are only ever read back and cleared now, which is why
 * `unlimitedStorage` stays until they have drained.
 *
 * Not unit-tested: chrome.storage is a system boundary, verified by manual QA.
 */
const KEY_PREFIX = "snapshot:";

interface StoredPhoto {
  filename: string;
  mimeType: string;
  base64: string;
}

type StoredLegacy = Omit<AdSnapshot, "photos"> & { photos: StoredPhoto[] };
type Stored = Exclude<RepostRecord, AdSnapshot> | StoredLegacy;

function keyFor(listingId: string): string {
  return `${KEY_PREFIX}${listingId}`;
}

function isLegacy(record: { phase: RepostRecord["phase"] }): boolean {
  return record.phase === "captured" || record.phase === "deleted";
}

function toStored(record: RepostRecord): Stored {
  if (!isLegacy(record)) return record as Stored;
  const legacy = record as AdSnapshot;
  return {
    ...legacy,
    photos: legacy.photos.map((p) => ({
      filename: p.filename,
      mimeType: p.mimeType,
      base64: bytesToBase64(p.data),
    })),
  };
}

function fromStored(stored: Stored): RepostRecord {
  if (!isLegacy(stored)) return stored as RepostRecord;
  const legacy = stored as StoredLegacy;
  const photos: Photo[] = legacy.photos.map((p) => ({
    filename: p.filename,
    mimeType: p.mimeType,
    data: base64ToBytes(p.base64),
  }));
  return { ...legacy, photos };
}

export class ChromeSnapshotStore implements SnapshotStore {
  async save(record: RepostRecord): Promise<void> {
    await chrome.storage.local.set({ [keyFor(record.listingId)]: toStored(record) });
  }

  async get(listingId: string): Promise<RepostRecord | null> {
    const key = keyFor(listingId);
    const result = await chrome.storage.local.get(key);
    const stored = result[key] as Stored | undefined;
    return stored ? fromStored(stored) : null;
  }

  async list(): Promise<RepostRecord[]> {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([key]) => key.startsWith(KEY_PREFIX))
      .map(([, value]) => fromStored(value as Stored));
  }

  async clear(listingId: string): Promise<void> {
    await chrome.storage.local.remove(keyFor(listingId));
  }
}
