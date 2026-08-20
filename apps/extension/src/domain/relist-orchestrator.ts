import type { RelistOutcomeCode } from "@mprelist/contracts";

import type { LockedState } from "../gate/authorization-gate";
import type { RelistPermission } from "../gate/relist-permission";
import { AdNotFoundError, type MarktplaatsClient } from "./marktplaats-client";
import type { SnapshotStore } from "./snapshot-store";
import type { AdSnapshot, ListingSummary } from "./types";

/** Outcome of a relist attempt. */
export type RelistOutcome =
  | { status: "relisted" }
  /** Nothing was removed from Marktplaats; the original ad is intact. */
  | { status: "failed-before-delete"; error: unknown }
  /** The original was deleted but re-create failed; snapshot retained for retry. */
  | { status: "failed-recoverable"; listingId: string; error: unknown }
  /**
   * The backend did not authorize it, so **nothing ran at all** — no capture, no
   * photos fetched, and certainly no delete. `locked` is what the row shows: an
   * upgrade prompt, a cooldown, "update your card", or "try again" (#34).
   */
  | { status: "refused"; locked: LockedState };

/**
 * The delete-first state machine (ADR-0003), now behind the gate (T26, #35).
 *
 * **The engine runs only on `proceed`.** The authorization is the first thing this
 * does — before the capture, which is what the backend's pacing rails count as an
 * attempt, and long before anything is deleted. There is no cached grant and no
 * offline path: a network failure, a timeout and a `402` all end here, unrun.
 *
 * The flow itself is untouched by this ticket. What is added around it is one call
 * before and one after, and the one after cannot change the outcome: reporting is
 * how a reservation settles or is refunded, and a relist that already happened is
 * not undone by our failing to say so.
 */
export class RelistOrchestrator {
  constructor(
    private readonly client: MarktplaatsClient,
    private readonly store: SnapshotStore,
    private readonly permission: RelistPermission,
  ) {}

  async captureAd (listingId: string) {
    const captured = await this.client.captureAd(listingId);
    console.log("Captured", captured);
  }

  async searchAd (query: string) {
    const ads = await this.client.searchAd(query)
    console.log("Searched ads", ads)
  }

  /**
   * The user's own ads, straight from their Marktplaats session.
   *
   * Returned rather than logged, which is what it did while its only caller was a
   * console hook: the popup renders these now (T30a, #39), and it asks the worker
   * rather than the content script so that one object owns the relay client.
   */
  async listAds(): Promise<ListingSummary[]> {
    return this.client.listMyAds();
  }

  async relist(listingId: string): Promise<RelistOutcome> {
    // 0. Permission first. Before the capture, because the capture is the attempt
    //    the backend's pacing rails count and it fetches every photo of the ad;
    //    and before everything else, because the next steps delete somebody's
    //    listing and fail-closed means that never happens on a stale grant.
    const decision = await this.permission.authorize(listingId);
    if (decision.decision === "refuse") {
      return { status: "refused", locked: decision.locked };
    }
    const grantJti = decision.grant.jti;

    // 1. Capture the full ad. A failure here removed nothing — the unit goes back.
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
        grantJti,
      };
    } catch (error) {
      console.error("Failed when capturing data");
      await this.report(grantJti, "FAILED_BEFORE_DELETE");
      return { status: "failed-before-delete", error };
    }

    // 2. Persist the durable snapshot BEFORE anything is deleted (ADR-0003).
    try {
      await this.store.save(snapshot);
    } catch (error) {
      console.error("failed saving snapshot");
      await this.report(grantJti, "FAILED_BEFORE_DELETE");
      return { status: "failed-before-delete", error };
    }

    // 3. Delete-first. A real delete failure means the original still exists, so
    //    abandon cleanly with no orphan snapshot.
    const deletion = await this.ensureDeleted(snapshot);
    if (!deletion.ok) {
      await this.store.clear(listingId);
      console.error("Failed ensuring deletion");
      await this.report(grantJti, "FAILED_BEFORE_DELETE");
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

  /**
   * Tell the backend what became of a relist it authorized.
   *
   * Swallows everything. The destructive half has already happened or already
   * failed by the time this is called, and a thrown reporting error would turn a
   * successful relist into a failed one on the screen. A reservation nobody
   * reports on is refunded by reconciliation after a grace window (#24), and a
   * report that arrives late still wins — which is what makes giving up safe.
   */
  private async report(jti: string | null | undefined, outcome: RelistOutcomeCode): Promise<void> {
    if (!jti) return;
    try {
      await this.permission.report(jti, outcome);
    } catch (error) {
      console.warn("[relist] outcome not reported", error);
    }
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

  /**
   * Finish an interrupted relist — and **re-authorize it if finishing it could
   * delete something.**
   *
   * That is the whole rule, and it is narrower than "resume re-authorizes"
   * because the two phases are not the same situation:
   *
   * - `captured`: the delete may not have run. Resuming may destroy a listing, so
   *   it needs a fresh grant like any other relist would — and the snapshot store
   *   is `chrome.storage.local`, which under ADR-0007 the *user* can write, so a
   *   fabricated snapshot must not be a way to delete-and-recreate for free.
   * - `deleted`: the ad is already gone and all that is left is putting it back.
   *   Refusing here would leave somebody's listing deleted because their quota ran
   *   out mid-relist, which is the exact outcome ADR-0003 keeps a snapshot to
   *   prevent — and a fabricated snapshot buys nothing, since creating an ad is
   *   something anyone may do on Marktplaats for nothing.
   *
   * Either way the outcome is reported against the reservation in the snapshot,
   * so a relist that outlived its worker still settles the unit it spent.
   */
  private async resumeSnapshot(snapshot: AdSnapshot): Promise<RelistOutcome> {
    let resuming = snapshot;

    if (resuming.phase === "captured") {
      const decision = await this.permission.authorize(resuming.listingId);
      if (decision.decision === "refuse") {
        // Nothing is touched and the snapshot stays: the ad is still there, and
        // the user can try again when whatever refused them has passed.
        return { status: "refused", locked: decision.locked };
      }

      // The new grant is the one this attempt owes an answer to. The old
      // reservation, if there was one, is the backend's to reconcile (#24).
      resuming = { ...resuming, grantJti: decision.grant.jti };
      await this.store.save(resuming);

      // The delete may or may not have run before interruption; ensure it is gone.
      // Here the snapshot is kept (recoverable) rather than cleared: the ad is
      // already at risk, so we never drop the only copy.
      const deletion = await this.ensureDeleted(resuming);
      if (!deletion.ok) {
        // Nothing of ours removed it, so the unit goes back — the ad the user
        // still has is the reason this is not a spent relist.
        await this.report(resuming.grantJti, "FAILED_BEFORE_DELETE");
        return { status: "failed-recoverable", listingId: resuming.listingId, error: deletion.error };
      }
    }

    return this.createFromSnapshot(resuming);
  }

  private async createFromSnapshot(snapshot: AdSnapshot): Promise<RelistOutcome> {
    try {
      await this.client.createAd(snapshot.draft, snapshot.photos);
      await this.store.clear(snapshot.listingId);
      await this.report(snapshot.grantJti, "SUCCESS");
      return { status: "relisted" };
    } catch (error) {
      // The original is already gone; keep the snapshot so the user can retry/restore.
      // The unit stands: the destructive half happened, whatever came after it.
      await this.report(snapshot.grantJti, "FAILED_AFTER_DELETE");
      return { status: "failed-recoverable", listingId: snapshot.listingId, error };
    }
  }
}
