import type { AdSnapshot } from "./types";

/**
 * System boundary (ADR-0003): durable storage of pre-delete snapshots. The real
 * implementation is chrome.storage.local (unlimitedStorage); the orchestrator is
 * tested against an in-memory fake of this interface.
 */
export interface SnapshotStore {
  /** Persist (or overwrite) the snapshot for a listing. */
  save(snapshot: AdSnapshot): Promise<void>;
  /** The snapshot for a listing, or null if none. */
  get(listingId: string): Promise<AdSnapshot | null>;
  /** All outstanding snapshots (used to resume interrupted relists). */
  list(): Promise<AdSnapshot[]>;
  /** Remove a listing's snapshot once its relist is complete. */
  clear(listingId: string): Promise<void>;
}
