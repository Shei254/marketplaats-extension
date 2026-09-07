import type { RelistOutcomeCode, RemainingQuota } from "@mprelist/contracts";

import type { LockedState } from "../gate/authorization-gate";
import type { RelistPermission } from "../gate/relist-permission";
import { AdNotFoundError, type MarktplaatsClient } from "./marktplaats-client";
import type { RelistPacing } from "./relist-pace";
import type { SnapshotStore } from "./snapshot-store";
import type { AdSnapshot, ListingSummary } from "./types";

/**
 * Outcome of a relist attempt.
 *
 * Everything that reported carries `quota` — what the period has left **now**,
 * from `/complete`'s own answer, so the popup can move its counter without asking
 * `/api/me` again (T32, #41). `null` means the backend was not told or told us
 * nothing readable, which a caller must not read as "unchanged": it is the
 * difference between knowing the number and knowing that we do not.
 */
export type RelistOutcome =
  | { status: "relisted"; quota: RemainingQuota | null }
  /** Nothing was removed from Marktplaats; the original ad is intact. */
  | { status: "failed-before-delete"; error: unknown; quota: RemainingQuota | null }
  /** The original was deleted but re-create failed; snapshot retained for retry. */
  | { status: "failed-recoverable"; listingId: string; error: unknown; quota: RemainingQuota | null }
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
 *
 * **And in front of all of it, the pace** (T46, #54). Every path that authorizes
 * waits its turn first and takes it after, so a run of relists arrives at
 * human-shaped intervals rather than as fast as a worker can loop. The wait is
 * here rather than in the popup because every surface goes through this object —
 * the popup today, the injected buttons of #51 next — and a rule kept in one
 * caller is a rule the second caller does not have.
 */
export class RelistOrchestrator {
  constructor(
    private readonly client: MarktplaatsClient,
    private readonly store: SnapshotStore,
    private readonly permission: RelistPermission,
    private readonly pace: RelistPacing,
    /**
     * The wider gap a run is paced by (T68, #147) — the same pacer over the same
     * stored deadline, drawing from a window of its own (`BULK_PACE`).
     *
     * **Defaults to the watched one**, which is what every suite here passes: the
     * two differ in the window they draw from and in nothing this class does, so a
     * test that had to wrap a second identical fake to say the same thing would be
     * paying for a seam it is not testing. The worker passes both, and it is the
     * only caller that has two windows to tell apart.
     */
    private readonly bulkPace: RelistPacing = pace,
  ) {}

  async captureAd (listingId: string) {
    const captured = await this.client.captureAd(listingId);
    console.log("Captured", captured);
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

  /**
   * The same ads, filtered by Marktplaats (T31, #40).
   *
   * Returned rather than logged, for `listAds`'s reason and after the same
   * mistake: this was a console hook that printed its answer, so the popup's
   * search box had nothing to render. **Nothing here debounces or supersedes** —
   * that is the surface's, because it is a property of somebody typing rather
   * than of the search itself, and the injected buttons (#51) will not have a box
   * at all.
   *
   * Not paced and not gated. It reads the user's own session, spends no quota and
   * deletes nothing — `docs/enforcement-contract.md` puts search beside the ad
   * list, ungated at every subscription state.
   */
  async searchAds(query: string): Promise<ListingSummary[]> {
    return this.client.searchAd(query);
  }

  /**
   * @param batch that this ad is one of several a run is working through (T68,
   * #147). Two things change and the delete-first flow is not either of them: the
   * authorization says so, which is what lets the API refuse a plan without
   * `bulk`; and the gap is drawn from the wider window, because a run's gaps are
   * walked away from rather than watched.
   */
  async relist(listingId: string, batch = false): Promise<RelistOutcome> {
    const pace = batch ? this.bulkPace : this.pace;

    // 0. Wait for the gap, before the authorization rather than after it (T46,
    //    #54). The backend's rails count from the reservation `authorize` takes,
    //    so a gap that ran after it would be measured against a clock that had
    //    already started — and a request that is going to be refused for arriving
    //    too soon should not be sent at all.
    //
    //    Nothing has happened yet at this point: no grant, no capture, no delete.
    //    So a worker that is torn down mid-wait — which Chrome may do once the
    //    popup that asked has closed — costs the user their click and nothing else.
    //
    //    **In a batch this has almost always already elapsed**, because the alarm
    //    that woke the worker was set from this same deadline. It is still waited
    //    on rather than skipped: the deadline is the one place either path reads
    //    the gap from, so an alarm that fired early — a clamp, a clock, a run
    //    started while a single repost was still pacing — is absorbed here instead
    //    of becoming a relist that arrives sooner than the pacer said it could.
    await pace.pause();

    // 1. Permission. Before the capture, because the capture is the attempt the
    //    backend's pacing rails count and it fetches every photo of the ad; and
    //    before everything else, because the next steps delete somebody's listing
    //    and fail-closed means that never happens on a stale grant.
    const decision = await this.permission.authorize(listingId, batch);
    if (decision.decision === "refuse") {
      // Nothing reached Marktplaats, so nothing is paced: a refusal is not an
      // action to space out, and spacing it would make the cooldown the user is
      // already being shown longer than the backend said.
      return { status: "refused", locked: decision.locked };
    }
    await pace.startedRelisting();
    const grantJti = decision.grant.jti;

    // 2. Capture the full ad. A failure here removed nothing — the unit goes back.
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
      return { status: "failed-before-delete", error, quota: await this.report(grantJti, "FAILED_BEFORE_DELETE") };
    }

    // 3. Persist the durable snapshot BEFORE anything is deleted (ADR-0003).
    try {
      await this.store.save(snapshot);
    } catch (error) {
      console.error("failed saving snapshot");
      return { status: "failed-before-delete", error, quota: await this.report(grantJti, "FAILED_BEFORE_DELETE") };
    }

    // 4. Delete-first. A real delete failure means the original still exists, so
    //    abandon cleanly with no orphan snapshot.
    const deletion = await this.ensureDeleted(snapshot);
    if (!deletion.ok) {
      await this.store.clear(listingId);
      console.error("Failed ensuring deletion");
      return {
        status: "failed-before-delete",
        error: deletion.error,
        quota: await this.report(grantJti, "FAILED_BEFORE_DELETE"),
      };
    }

    // 5. Re-create the identical ad from the snapshot.
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
  private async report(
    jti: string | null | undefined,
    outcome: RelistOutcomeCode,
  ): Promise<RemainingQuota | null> {
    if (!jti) return null;
    try {
      return await this.permission.report(jti, outcome);
    } catch (error) {
      console.warn("[relist] outcome not reported", error);
      return null;
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
      // Paced like any other attempt, and for the same reason: this one may still
      // delete a listing, so it is an action against Marktplaats rather than the
      // tail of one. The `deleted` phase below is not paced — putting somebody's
      // ad back is recovery, and making them wait for it is making the ADR-0003
      // snapshot slower to redeem than the failure it exists for.
      await this.pace.pause();
      const decision = await this.permission.authorize(resuming.listingId);
      if (decision.decision === "refuse") {
        // Nothing is touched and the snapshot stays: the ad is still there, and
        // the user can try again when whatever refused them has passed.
        return { status: "refused", locked: decision.locked };
      }

      await this.pace.startedRelisting();

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
        return {
          status: "failed-recoverable",
          listingId: resuming.listingId,
          error: deletion.error,
          quota: await this.report(resuming.grantJti, "FAILED_BEFORE_DELETE"),
        };
      }
    }

    return this.createFromSnapshot(resuming);
  }

  private async createFromSnapshot(snapshot: AdSnapshot): Promise<RelistOutcome> {
    // Taken before the create and only for an ad that was reserved, so an
    // ordinary repost costs no extra request at all (T71, #157).
    const before = snapshot.draft.reserved ? await this.adIdsNow() : null;

    try {
      await this.client.createAd(snapshot.draft, snapshot.photos);
      await this.store.clear(snapshot.listingId);
      // After the snapshot is cleared, deliberately. The clear is what says the
      // relist finished, and a worker torn down between the create and the clear
      // is resumed into a *second* create of the same ad — so nothing that can
      // block goes in that gap for the sake of a flag.
      if (snapshot.draft.reserved) await this.keepReserved(snapshot.listingId, before);
      return { status: "relisted", quota: await this.report(snapshot.grantJti, "SUCCESS") };
    } catch (error) {
      // The original is already gone; keep the snapshot so the user can retry/restore.
      // The unit stands: the destructive half happened, whatever came after it.
      return {
        status: "failed-recoverable",
        listingId: snapshot.listingId,
        error,
        quota: await this.report(snapshot.grantJti, "FAILED_AFTER_DELETE"),
      };
    }
  }

  /**
   * Put the **Gereserveerd** flag back on the ad the repost just created
   * (T71, #157; ADR-0028).
   *
   * A repost is delete-and-recreate (ADR-0002) and the new ad is not identical:
   * it comes back unreserved, so an item its seller had promised to a buyer goes
   * quietly back on the open market as a side-effect of our own mechanic. The
   * rule being encoded is *a reposted ad keeps the flag it had*, which is domain
   * state and belongs here rather than in the HTTP layer.
   *
   * **Finding the new ad's id is the hard part**, because `createAd` returns
   * none: Marktplaats answers the create with a redirect chain ending on
   * `/seller/view/:id`, and reading that final URL is exact, free — and depends
   * on the middle hop being a server redirect, which nobody has observed. So this
   * diffs `listMyAds` around the create instead, and **exactly one addition is
   * the new ad**. Zero means we could not find it (list lag, or T37's open
   * pagination question); more than one means somebody posted an ad by hand in
   * another tab inside the window, and reserving the wrong one marks an unrelated
   * *live* listing as promised to a buyer. Either way this does nothing, because
   * doing nothing is the smaller harm and there is nothing here to guess with.
   *
   * **It fails silently, and that is the decision.** Nothing reaches the popup
   * and the outcome stays `relisted`: the repost *did* succeed, the ad is live,
   * and the quota unit is rightly spent. Reporting `FAILED_AFTER_DELETE` because
   * a flag did not stick would lie to the breakage canary. What is lost is the
   * seller's knowledge that an item they promised is back on the market, which is
   * a real cost and is mitigated only by the log line below — it names which of
   * the four cases this was, because that is the whole diagnosis.
   *
   * @param before the ids `listMyAds` held before the create, or `null` when that
   * call failed — in which case there is no diff to take and no id to guess.
   */
  private async keepReserved(listingId: string, before: ReadonlySet<string> | null): Promise<void> {
    if (!before) {
      console.warn(`[relist] ${listingId} was reserved; could not list ads before the repost`);
      return;
    }

    const after = await this.adIdsNow();
    if (!after) {
      console.warn(`[relist] ${listingId} was reserved; could not list ads after the repost`);
      return;
    }

    const added = [...after].filter((id) => !before.has(id));
    if (added.length !== 1) {
      // Named rather than counted away: 0 and 2 are different failures with
      // different fixes, and the number is what tells them apart in a log.
      console.warn(
        `[relist] ${listingId} was reserved; the repost added ${added.length} ads, ` +
          `so there is no one new ad to flag`,
      );
      return;
    }

    const newListingId = added[0]!;
    try {
      await this.client.reserveAd(newListingId);
    } catch (error) {
      console.warn(`[relist] ${listingId} was reserved; ${newListingId} could not be`, error);
    }
  }

  /**
   * The ids Marktplaats currently holds for this user, or `null` if it would not
   * say. Swallows, because both of its callers are on the success path of a
   * repost that has already happened: a listing call that failed must not turn a
   * live ad into a failed relist on the screen.
   */
  private async adIdsNow(): Promise<Set<string> | null> {
    try {
      return new Set((await this.client.listMyAds()).map((ad) => ad.id));
    } catch (error) {
      console.warn("[relist] could not list ads for the reserve diff", error);
      return null;
    }
  }
}
