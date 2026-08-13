import { AdNotFoundError, type MarktplaatsClient } from "./marktplaats-client";
import type { SnapshotStore } from "./snapshot-store";
import type { AdSnapshot } from "./types";

/** Outcome of a relist attempt. */
export type RelistOutcome =
  | { status: "relisted" }
  /** Nothing was removed from Marktplaats; the original ad is intact. */
  | { status: "failed-before-delete"; error: unknown }
  /** The original was deleted but re-create failed; snapshot retained for retry. */
  | { status: "failed-recoverable"; listingId: string; error: unknown }
  | null;

export class RelistOrchestrator {
  constructor(
    private readonly client: MarktplaatsClient,
    private readonly store: SnapshotStore,
  ) {}

  async captureAd (listingId: string) {
    const captured = await this.client.captureAd(listingId);
    console.log("Captured", captured);
  }

  async searchAd (query: string) {
    const ads = await this.client.searchAd(query)
    console.log("Searched ads", ads)
  }

  async listAds () {
    const ads = await this.client.listMyAds();
    console.log(ads);
  }

  async relist(listingId: string): Promise<RelistOutcome> {
    // 1. Capture the full ad. A failure here removed nothing.
    let snapshot: AdSnapshot;
    try {
      const captured = await this.client.captureAd(listingId);
      console.log("Captured", captured);
      snapshot = {
        listingId,
        draft: captured.draft,
        photos: captured.photos,
        phase: "captured",
        createdAt: Date.now(),
      };
    } catch (error) {
      console.error("Failed when capturing data");
      return { status: "failed-before-delete", error };
    }

    // 2. Persist the durable snapshot BEFORE anything is deleted (ADR-0003).
    try {
      await this.store.save(snapshot);
    } catch (error) {
      console.error("failed saving snapshot");
      return { status: "failed-before-delete", error };
    }

    // 3. Delete-first. A real delete failure means the original still exists, so
    //    abandon cleanly with no orphan snapshot.
    const deletion = await this.ensureDeleted(snapshot);
    if (!deletion.ok) {
      await this.store.clear(listingId);
      console.error("Failed ensuring deletion");
      return { status: "failed-before-delete", error: deletion.error };
    }

    // 4. Re-create the identical ad from the snapshot.
    return this.createFromSnapshot(snapshot);
  }

  /**
   * Delete the original, tolerating "already gone", and advance the snapshot to the
   * "deleted" phase on success. Returns the delete failure instead of throwing so
   * callers can choose their own outcome (abort vs. keep-for-retry).
   */
  private async ensureDeleted(
    snapshot: AdSnapshot,
  ): Promise<{ ok: true } | { ok: false; error: unknown }> {
    try {
      await this.client.deleteAd(snapshot.listingId);
    } catch (error) {
      if (!(error instanceof AdNotFoundError)) return { ok: false, error };
    }
    await this.store.save({ ...snapshot, phase: "deleted" });
    return { ok: true };
  }

  /** Retry a relist that was left recoverable, from its persisted snapshot. */
  async retry(listingId: string): Promise<RelistOutcome> {
    const snapshot = await this.store.get(listingId);
    if (!snapshot) throw new Error(`No snapshot to retry for listing ${listingId}`);
    return this.resumeSnapshot(snapshot);
  }

  /** Resume every interrupted relist (e.g. on extension startup after a crash). */
  async resumeAll(): Promise<RelistOutcome[]> {
    const snapshots = await this.store.list();
    const outcomes: RelistOutcome[] = [];
    for (const snapshot of snapshots) {
      outcomes.push(await this.resumeSnapshot(snapshot));
    }
    return outcomes;
  }

  private async resumeSnapshot(snapshot: AdSnapshot): Promise<RelistOutcome> {
    if (snapshot.phase === "captured") {
      // The delete may or may not have run before interruption; ensure it is gone.
      // Here the snapshot is kept (recoverable) rather than cleared: the ad is
      // already at risk, so we never drop the only copy.
      const deletion = await this.ensureDeleted(snapshot);
      if (!deletion.ok) {
        return { status: "failed-recoverable", listingId: snapshot.listingId, error: deletion.error };
      }
    }
    return this.createFromSnapshot(snapshot);
  }

  private async createFromSnapshot(snapshot: AdSnapshot): Promise<RelistOutcome> {
    try {
      await this.client.createAd(snapshot.draft, snapshot.photos);
      await this.store.clear(snapshot.listingId);
      return { status: "relisted" };
    } catch (error) {
      // The original is already gone; keep the snapshot so the user can retry/restore.
      return { status: "failed-recoverable", listingId: snapshot.listingId, error };
    }
  }
}
