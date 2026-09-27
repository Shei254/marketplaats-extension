import type { RelistOutcomeCode, RemainingQuota } from "@mprelist/contracts";

import type { LockedState } from "../gate/authorization-gate";
import type { RelistPermission } from "../gate/relist-permission";
import { AdNotFoundError, ApiRequestError, SpikePendingError, type MarktplaatsClient } from "./marktplaats-client";
import type { RelistPacing } from "./relist-pace";
import type { SnapshotStore } from "./snapshot-store";
import type { AdSnapshot, ListingSummary, PendingRepost } from "./types";

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
 * An interrupted repost whose ad Marktplaats still has: nothing was deleted, so
 * it is cancelled rather than finished, and its unit handed back (ADR-0039).
 */
export class RepostCancelledError extends Error {
  constructor() {
    super("De herplaatsing werd onderbroken voordat er iets verwijderd was.");
    this.name = "RepostCancelledError";
  }
}

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
  /**
   * Reposts running now, by listing id. A resume skips them and a second click
   * joins them: their snapshot looks exactly like an interrupted one, and
   * finishing it twice is the ad posted twice (ADR-0039).
   */
  private readonly running = new Map<string, Promise<RelistOutcome>>();

  /** The resume in progress, which a second caller joins rather than repeats. */
  private resuming: Promise<RelistOutcome[]> | null = null;

  constructor(
    private readonly client: MarktplaatsClient,
    private readonly store: SnapshotStore,
    private readonly permission: RelistPermission,
    private readonly pace: RelistPacing,
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

  relist(listingId: string): Promise<RelistOutcome> {
    return this.once(listingId, () => this.relistNow(listingId));
  }

  private async relistNow(listingId: string): Promise<RelistOutcome> {
    // 0. Wait for the gap, before the authorization rather than after it (T46,
    //    #54). The backend's rails count from the reservation `authorize` takes,
    //    so a gap that ran after it would be measured against a clock that had
    //    already started — and a request that is going to be refused for arriving
    //    too soon should not be sent at all.
    //
    //    Nothing has happened yet at this point: no grant, no capture, no delete.
    //    So a worker that is torn down mid-wait — which Chrome may do once the
    //    popup that asked has closed — costs the user their click and nothing else.
    await this.pace.pause();

    // 1. Permission. Before the capture, because the capture is the attempt the
    //    backend's pacing rails count and it fetches every photo of the ad; and
    //    before everything else, because the next steps delete somebody's listing
    //    and fail-closed means that never happens on a stale grant.
    const decision = await this.permission.authorize(listingId);
    if (decision.decision === "refuse") {
      // Nothing reached Marktplaats, so nothing is paced: a refusal is not an
      // action to space out, and spacing it would make the cooldown the user is
      // already being shown longer than the backend said.
      return { status: "refused", locked: decision.locked };
    }
    await this.pace.startedRelisting();
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
  retry(listingId: string): Promise<RelistOutcome> {
    return this.once(listingId, async () => {
      const snapshot = await this.store.get(listingId);
      if (!snapshot) throw new Error(`No snapshot to retry for listing ${listingId}`);
      return this.resumeSnapshot(snapshot);
    });
  }

  /** Every repost the extension is holding a snapshot of, as the popup lists them. */
  async pendingReposts(): Promise<PendingRepost[]> {
    return (await this.store.list()).map((snapshot) => ({
      listingId: snapshot.listingId,
      title: snapshot.draft.title,
      needsUser: snapshot.needsUser ?? false,
      running: this.running.has(snapshot.listingId),
    }));
  }

  /**
   * Drop a pending repost at the user's word: the snapshot goes, and with it the
   * only copy of an ad that may no longer be on Marktplaats. Nothing is reported
   * — the unit was settled when the delete happened. Refused (`false`) while it
   * is being put back, since that attempt may be creating the ad this second.
   */
  async letGo(listingId: string): Promise<boolean> {
    if (this.running.has(listingId)) return false;
    await this.store.clear(listingId);
    return true;
  }

  /** Run `work` for a listing unless it is already running, in which case join it. */
  private once(listingId: string, work: () => Promise<RelistOutcome>): Promise<RelistOutcome> {
    const running = this.running.get(listingId);
    if (running) return running;
    const started = work().finally(() => this.running.delete(listingId));
    this.running.set(listingId, started);
    return started;
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

  /**
   * Finish every pending repost that is not waiting for the user or already
   * running (ADR-0039). Run on every marktplaats.nl page load and by the retry
   * schedule, so it is cheap when there is nothing to do: one storage read.
   */
  resumeAll(): Promise<RelistOutcome[]> {
    this.resuming ??= this.resumeEach().finally(() => (this.resuming = null));
    return this.resuming;
  }

  private async resumeEach(): Promise<RelistOutcome[]> {
    const snapshots = (await this.store.list()).filter(
      (snapshot) => !snapshot.needsUser && !this.running.has(snapshot.listingId),
    );
    const outcomes: RelistOutcome[] = [];
    for (const snapshot of snapshots) {
      outcomes.push(await this.once(snapshot.listingId, () => this.resumeSnapshot(snapshot)));
    }
    return outcomes;
  }


  /**
   * Finish an interrupted relist — **by putting the ad back, and never by asking
   * the gate again** (ADR-0039).
   *
   * - `deleted`: the ad is gone; recreate it. Refusing here would leave somebody's
   *   listing deleted because their quota ran out mid-relist, which is the exact
   *   outcome ADR-0003 keeps a snapshot to prevent.
   * - `captured`: the delete may or may not have run, and Marktplaats is asked
   *   which. An ad it still serves is **cancelled** — nothing was deleted, so its
   *   unit is refunded now and the user reposts again if they still want to. One
   *   that answers `410 Gone` is a `deleted` snapshot that did not get to say so.
   *   Anything else is not known, and the snapshot waits for the next attempt.
   *
   * So a resume deletes nothing, and ADR-0007's reason to gate it — the store is
   * the user's to write — has nothing left to protect: a fabricated snapshot of a
   * live ad is dropped, and one of an absent ad buys a create, which anyone may
   * do on Marktplaats for nothing.
   *
   * The outcome is reported against the reservation in the snapshot, so a relist
   * that outlived its worker still settles the unit it spent.
   */
  private async resumeSnapshot(snapshot: AdSnapshot): Promise<RelistOutcome> {
    if (snapshot.phase === "deleted") return this.createFromSnapshot(snapshot);

    try {
      await this.client.captureAd(snapshot.listingId);
    } catch (error) {
      if (!isGone(error)) {
        return { status: "failed-recoverable", listingId: snapshot.listingId, error, quota: null };
      }
      const deleted: AdSnapshot = { ...snapshot, phase: "deleted" };
      await this.store.save(deleted);
      return this.createFromSnapshot(deleted);
    }

    await this.store.clear(snapshot.listingId);
    return {
      status: "failed-before-delete",
      error: new RepostCancelledError(),
      quota: await this.report(snapshot.grantJti, "FAILED_BEFORE_DELETE"),
    };
  }

  private async createFromSnapshot(snapshot: AdSnapshot): Promise<RelistOutcome> {
    // A create tried before may have landed and lost its reply: look for the ad
    // it made before making another (ADR-0039).
    if (snapshot.idsBeforeCreate) {
      let landed: string | null;
      try {
        landed = await this.adTheLastCreateMade(snapshot, snapshot.idsBeforeCreate);
      } catch (error) {
        // Not knowing is not permission to create again: this attempt waits.
        return { status: "failed-recoverable", listingId: snapshot.listingId, error, quota: null };
      }
      if (landed) {
        await this.store.clear(snapshot.listingId);
        if (snapshot.draft.reserved) await this.reserve(snapshot.listingId, landed);
        return { status: "relisted", quota: await this.report(snapshot.grantJti, "SUCCESS") };
      }
    }

    // Recorded before the create, for the check above and for the reserve diff
    // below (T71, #157).
    const ids = await this.adIdsNow();
    const attempt: AdSnapshot = {
      ...snapshot,
      phase: "deleted",
      idsBeforeCreate: ids ? [...ids] : null,
      needsUser: false,
    };
    await this.store.save(attempt);

    try {
      await this.client.createAd(snapshot.draft, snapshot.photos);
      await this.store.clear(snapshot.listingId);
      // After the snapshot is cleared, deliberately. The clear is what says the
      // relist finished, and a worker torn down between the create and the clear
      // is resumed into a *second* create of the same ad — so nothing that can
      // block goes in that gap for the sake of a flag.
      if (snapshot.draft.reserved) await this.keepReserved(snapshot.listingId, ids);
      return { status: "relisted", quota: await this.report(snapshot.grantJti, "SUCCESS") };
    } catch (error) {
      // The original is already gone; keep the snapshot so the user can retry/restore.
      // The unit stands: the destructive half happened, whatever came after it.
      if (sendingAgainCannotFix(error)) await this.store.save({ ...attempt, needsUser: true });
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

    await this.reserve(listingId, added[0]!);
  }

  private async reserve(listingId: string, newListingId: string): Promise<void> {
    try {
      await this.client.reserveAd(newListingId);
    } catch (error) {
      console.warn(`[relist] ${listingId} was reserved; ${newListingId} could not be`, error);
    }
  }

  /**
   * The id of the ad an earlier create made, if exactly one ad has appeared
   * since it was sent and carries the snapshot's title and price; otherwise
   * `null` (ADR-0039).
   *
   * One is the only answer trusted. None means the create did not land, and two
   * means something else was posted in the window and there is nothing to tell
   * ours by — both mean "create", which is what happened before this existed.
   */
  private async adTheLastCreateMade(snapshot: AdSnapshot, before: readonly string[]): Promise<string | null> {
    const earlier = new Set(before);
    const priceCents = Number(snapshot.draft.price.priceCent);
    const ads = await this.client.listMyAds();
    const matches = ads.filter(
      (ad) => !earlier.has(ad.id) && ad.title === snapshot.draft.title && ad.priceCents === priceCents,
    );
    return matches.length === 1 ? matches[0]!.id : null;
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

/**
 * Marktplaats saying an ad no longer exists: `410 Gone` is what a deleted ad
 * answers a capture with (observed 2026-09-27), and `404` is kept beside it as
 * the other honest way to say so. Nothing else is read as gone — a `200` whose
 * page carried no ad is a layout change, not a deletion.
 */
function isGone(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 404 || error.status === 410);
}

/**
 * A create failure that the same request will meet again: Marktplaats refusing
 * the body itself (a `4xx` that is not about the session or the rate), or an
 * endpoint nobody has configured. Everything else — the network, a `5xx`, a
 * `429` — may pass, and is retried (ADR-0039).
 */
function sendingAgainCannotFix(error: unknown): boolean {
  if (error instanceof SpikePendingError) return true;
  if (!(error instanceof ApiRequestError)) return false;
  const passing = [401, 403, 408, 429];
  return error.status >= 400 && error.status < 500 && !passing.includes(error.status);
}
