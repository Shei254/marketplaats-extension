import type { RepostRecord } from "./types";

/**
 * System boundary: where a **Pending repost** is held until it finishes. The real
 * implementation is chrome.storage.local; the orchestrator is tested against an
 * in-memory fake of this interface. Create-first records are a few ids
 * (ADR-0041); ADR-0003's snapshots, with their photos, are only read and cleared.
 */
export interface SnapshotStore {
  /** Persist (or overwrite) the record for a listing. */
  save(record: RepostRecord): Promise<void>;
  /** The record for a listing, or null if none. */
  get(listingId: string): Promise<RepostRecord | null>;
  /** Every outstanding record (used to finish interrupted reposts). */
  list(): Promise<RepostRecord[]>;
  /** Remove a listing's record once its repost is finished. */
  clear(listingId: string): Promise<void>;
}
