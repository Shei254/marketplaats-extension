import type { RelistOutcomeCode, RemainingQuota } from "@mprelist/contracts";

import type { LockedState } from "../gate/authorization-gate";
import type { RelistPermission } from "../gate/relist-permission";
import {
  AdNotFoundError,
  ApiRequestError,
  CreateNotConfirmedError,
  SpikePendingError,
  type MarktplaatsClient,
  DraftUnusableError, NotAuthenticatedError
} from "./marktplaats-client";
import type { RelistPacing } from "./relist-pace";
import type { SnapshotStore } from "./snapshot-store";
import type {
  AdPresence,
  AdSnapshot,
  AdsPage,
  CapturedAd,
  CapturedListing,
  CreateUnconfirmed,
  Landed,
  ListingSummary,
  OldAdToDelete,
  PendingRepost,
  RepostRecord,
} from "./types";
import {failureKind, type FailureKind} from "./failure";

const CREATE_WINDOW_MS = 180_000;
const MAX_CREATE_ATTEMPTS = 3;
const CHECK_BACKOFF_MS = [5_000, 15_000, 60_000, 300_000];

const settled = (sentAt: number | undefined, windowMs: number) =>
    sentAt === undefined || Date.now() - sentAt > windowMs;

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
  /**
   * `newListingId` is the copy the Confirmed create named — the ad that now stands
   * where the original did, at the top of the seller's list.
   */
  | { status: "relisted"; newListingId: string; quota: RemainingQuota | null }
  /** Nothing was removed from Marktplaats; the original ad is intact. */
  | { status: "failed-before-delete"; error: unknown; quota: RemainingQuota | null }
  /**
   * Only an ADR-0003 snapshot can end here now: its original was deleted and the
   * re-create failed, so the stored copy is kept for retry.
   */
  | { status: "failed-recoverable"; listingId: string; error: unknown; quota: RemainingQuota | null }
  /**
   * The backend did not authorize it, so **nothing ran at all** — no capture, no
   * photos fetched, and certainly no delete. `locked` is what the row shows: an
   * upgrade prompt, a cooldown, "update your card", or "try again" (#34).
   */
  | { status: "refused"; locked: LockedState }
  | { status: "unconfirmed"; listingId: string; reason: FailureKind }
  | { status: "busy"; listingId: string; reason: "running" | "pending" };

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
 * The repost state machine — create-first since ADR-0041, behind the gate (T26, #35).
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
  private current: { listingId: string; promise: Promise<RelistOutcome> } | null = null;
  private isRunning(id: string) { return this.current?.listingId === id; }
  activeRepost(): string | null { return this.current?.listingId ?? null; }


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
  }

  /** One page of the ad list, with the total. Ungated and unpaced, like `listAds`. */
  async listAdsPage(batchNumber?: number, batchSize?: number): Promise<AdsPage> {
    return this.client.listMyAdsPage(batchNumber, batchSize);
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
    return this.once(listingId, "start", () => this.relistNow(listingId));
  }

  /**
   * **Create-first** (ADR-0041): capture → create → confirm → delete. The original
   * is deleted only after a Confirmed create, by the id the user chose, so no
   * failure anywhere in here leaves the seller with fewer ads than they had.
   */
  private async relistNow(listingId: string): Promise<RelistOutcome> {
    // 0. Wait for the gap, before the authorization rather than after it (T46,
    //    #54). The backend's rails count from the reservation `authorize` takes,
    //    so a gap that ran after it would be measured against a clock that had
    //    already started — and a request that is going to be refused for arriving
    //    too soon should not be sent at all.
    await this.pace.pause();

    // 1. Permission, before the capture — the attempt the backend's pacing rails
    //    count — and fail-closed: a stale grant never reaches Marktplaats.
    const decision = await this.permission.authorize(listingId);
    if (decision.decision === "refuse") {
      // Nothing reached Marktplaats, so nothing is paced.
      return { status: "refused", locked: decision.locked };
    }
    await this.pace.startedRelisting();
    const grantJti = decision.grant.jti;

    // 2. Capture the ad. Held in memory only: the original stays live until a
    //    confirmed create, so it is its own backup (ADR-0041).
    let captured: CapturedListing;
    try {
      captured = await this.client.captureAd(listingId);
    } catch (error) {
      console.error("[relist] could not capture", listingId, error);
      return this.nothingChanged(listingId, grantJti, error);
    }

    // 3. The ids before the create, so a create whose reply is lost can be found
    //    rather than posted twice. Unreadable, and there is nothing to look with.
    const before = await this.currentAds();
    if (before === null) return this.nothingChanged(listingId, grantJti, new Error("could not list ads"));

    const record: CreateUnconfirmed = {
      phase: "creating",
      listingId,
      title: captured.draft.title,
      reserved: captured.draft.reserved,
      thumbnailUrl: firstPhoto(captured.draft),
      grantJti,
      createdAt: Date.now(),
      idsBeforeCreate: before.map((ad) => ad.id),
      createSentAt: Date.now(),
      attempts: 1,
    };
    try {
      await this.store.save(record);
    } catch (error) {
      console.error("[relist] could not save the pending repost", error);
      return this.nothingChanged(listingId, grantJti, error);
    }

    return this.createAndConfirm(record, captured);
  }

  /** 4. Create, and on a Confirmed create, replace the original with it. */
  private async createAndConfirm(record: CreateUnconfirmed, captured: CapturedListing): Promise<RelistOutcome> {
    let newId: string;
    try {
      newId = await this.client.createAd(captured.draft, captured.photos);
    } catch (error) {
      return this.createNotConfirmed(record, error);
    }
    return this.replaceOriginal(record, newId);
  }

  /**
   * The create did not confirm. **Nothing has been deleted**, so every way out of
   * here leaves the original live — the only question is whether a copy exists.
   */
  private async createNotConfirmed(record: CreateUnconfirmed, error: unknown): Promise<RelistOutcome> {
    // A chain that stopped at a payment page placed nothing, and never will for
    // free. We never pay on a seller's behalf: this ad cannot be reposted.
    if (error instanceof CreateNotConfirmedError && error.paymentRequired) {
      return this.cancel(record, error);
    }

    // Anything else may still have placed the ad and lost the reply: look once.
    // A miss here is not the last word — every retry looks again, after the
    // create's window, before it sends another.
    const seen = await this.lookForCreated(record);
    if (seen.state === "landed") return this.replaceOriginal(record, seen.id);
    if (seen.state === "ambiguous") return this.park({ ...record, needsUser: true }, "unknown");

    // Seen not to have landed, and Marktplaats gave an answer the same request
    // would get again: nothing was placed, and nothing will be.
    const answered = error instanceof CreateNotConfirmedError || sendingAgainCannotFix(error);
    if (seen.state === "none" && answered) {
      return this.cancel(record, error);
    }
    return this.park({ ...record, failure: failureKind(error) }, failureKind(error));
  }

  /**
   * 5. A Confirmed create placed `newId`: flag it if the original was reserved,
   *    then delete the original — by its own id, never by a match (ADR-0041).
   */
  private async replaceOriginal(
    record: CreateUnconfirmed | OldAdToDelete,
    newId: string,
  ): Promise<RelistOutcome> {
    const replaced: OldAdToDelete = {
      phase: "replaced",
      listingId: record.listingId,
      title: record.title,
      thumbnailUrl: record.thumbnailUrl,
      grantJti: record.grantJti,
      createdAt: record.createdAt,
      newListingId: newId,
    };
    try {
      await this.store.save(replaced);
    } catch (error) {
      // The delete still runs: a record that says "creating" would only make a
      // retry look for this ad, find it, and replace again.
      console.warn("[relist] could not record the confirmed create", error);
    }

    if (record.phase === "creating" && record.reserved) await this.reserve(record.listingId, newId);

    const deletion = await this.deleteOriginal(record.listingId);
    if (deletion.deleted) {
      await this.store.clear(record.listingId);
      return { status: "relisted", newListingId: newId, quota: await this.report(record.grantJti, "SUCCESS") };
    }

    // Two copies are live, the new one on top: the seller got what the unit buys,
    // and the delete is retried. FAILED_AFTER_DELETE now means exactly this — the
    // breakage canary for the mechanic's second half (ADR-0041).
    await this.park({ ...replaced, failure: failureKind(deletion.error) }, failureKind(deletion.error));
    return { status: "relisted", newListingId: newId, quota: await this.report(record.grantJti, "FAILED_AFTER_DELETE") };
  }

  /** Delete the original, counting "already gone" as deleted. */
  private async deleteOriginal(listingId: string): Promise<{ deleted: true } | { deleted: false; error: unknown }> {
    try {
      await this.client.deleteAd(listingId);
      return { deleted: true };
    } catch (error) {
      if (error instanceof AdNotFoundError || isGone(error)) return { deleted: true };
      return (await this.probe(listingId)) === "gone" ? { deleted: true } : { deleted: false, error };
    }
  }

  /** Nothing was created and nothing deleted: drop the record and hand the unit back. */
  private async cancel(record: RepostRecord, error: unknown): Promise<RelistOutcome> {
    try {
      await this.store.clear(record.listingId);
    } catch { /* a stale record is looked through, never acted on blindly */ }
    return this.nothingChanged(record.listingId, record.grantJti, error);
  }

  private async nothingChanged(_listingId: string, jti: string | null | undefined, error: unknown): Promise<RelistOutcome> {
    return { status: "failed-before-delete", error, quota: await this.report(jti, "FAILED_BEFORE_DELETE") };
  }

  private async probe(id: string): Promise<AdPresence> {
    try {
      return await this.client.probeAd(id);
    } catch {
      return "unknown";
    }
  }

  /** Retry a pending repost at the user's word — Opnieuw. */
  retry(listingId: string): Promise<RelistOutcome> {
    return this.once(listingId, "finish", async () => {
      const record = await this.store.get(listingId);
      if (!record) throw new Error(`No pending repost for listing ${listingId}`);
      return this.resumeRecord(record, true);
    });
  }

  /** Every repost the extension is holding a record of, as the popup lists them. */
  async pendingReposts(): Promise<PendingRepost[]> {
    return (await this.store.list()).map((record) => ({
      listingId: record.listingId,
      title: isLegacy(record) ? record.draft.title : record.title,
      needsUser: record.needsUser ?? false,
      running: this.isRunning(record.listingId),
      deleted: record.phase === "deleted",
      replaced: record.phase === "replaced",
      failure: record.failure,
      thumbnailUrl: isLegacy(record) ? firstPhoto(record.draft) : record.thumbnailUrl,
    }));
  }

  /**
   * Drop a pending repost at the user's word. Nothing is reported. Refused
   * (`false`) while it is being finished, since that attempt may be creating or
   * deleting this second.
   */
  async letGo(listingId: string): Promise<boolean> {
    if (this.isRunning(listingId)) return false;
    await this.store.clear(listingId);
    return true;
  }

  /** Run `work` for a listing unless it is already running, in which case join it. */
  private once(listingId: string, kind: "start" | "finish", work: () => Promise<RelistOutcome>) {
    if (this.current?.listingId === listingId) return this.current.promise;
    if (this.current) {
      return Promise.resolve<RelistOutcome>({ status: "busy", listingId: this.current.listingId, reason: "running" });
    }
    const promise = (async (): Promise<RelistOutcome> => {
      if (kind === "start") {
        const blocking = await this.unfinishedRepost(listingId);
        if (blocking) return { status: "busy", listingId: blocking, reason: "pending" };
      }
      return work();
    })().finally(() => { this.current = null; });
    this.current = { listingId, promise };   // taken synchronously, before any await
    return promise;
  }

  private async unfinishedRepost(listingId: string): Promise<string | null> {
    const stored = await this.store.list();
    return stored.find((s) => s.listingId !== listingId && !s.needsUser)?.listingId ?? null;
  }

  /**
   * Tell the backend what became of a repost it authorized.
   *
   * Swallows everything: a thrown reporting error would turn a finished repost
   * into a failed one on the screen. A reservation nobody reports on is refunded
   * by reconciliation after a grace window (#24), and `/complete` keeps the first
   * report per grant — which is what lets a resume report again safely.
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
    const records = (await this.store.list()).filter(
      (record) => !record.needsUser && !this.isRunning(record.listingId),
    );
    const outcomes: RelistOutcome[] = [];
    for (const record of records) {
      if (this.current) break;
      outcomes.push(await this.once(record.listingId, "finish", () => this.resumeRecord(record)));
    }
    return outcomes;
  }

  /**
   * Finish a pending repost — **never by asking the gate again** (ADR-0039), and
   * never by deleting an ad whose replacement is not live (ADR-0041).
   *
   * @param explicit an Opnieuw the user pressed, rather than a background retry.
   * It lifts the attempt cap, which exists to stop the background, and the waits.
   */
  private async resumeRecord(record: RepostRecord, explicit = false): Promise<RelistOutcome> {
    switch (record.phase) {
      case "creating":
        return this.resumeCreate(record, explicit);
      case "replaced":
        return this.finishReplacing(record);
      case "deleted":
        return this.legacyRecreate(record, explicit);
      case "captured":
        return this.legacyResumeCaptured(record, explicit);
    }
  }

  /**
   * **Create unconfirmed.** Look for the create that may have landed; failing
   * that, capture the original again — it is live, so it is the backup — and
   * create from what the seller has *now*.
   */
  private async resumeCreate(record: CreateUnconfirmed, explicit: boolean): Promise<RelistOutcome> {
    const found = await this.lookForCreated(record);
    if (found.state === "landed") return this.replaceOriginal(record, found.id);
    if (found.state === "ambiguous") return this.park({ ...record, needsUser: true }, "unknown");
    if (found.state === "unknown") return this.park(record, "unknown");
    // Give a sent create its window to show up in the list before sending another.
    if (!explicit && !settled(record.createSentAt, CREATE_WINDOW_MS)) return this.park(record, "unknown");
    if (!explicit && record.attempts >= MAX_CREATE_ATTEMPTS) {
      return this.park({ ...record, needsUser: true }, "unknown");
    }

    const original = await this.probe(record.listingId);
    // Gone, and no copy of ours is live: the seller removed it themselves, and
    // there is nothing left for this repost to do.
    if (original === "gone") return this.cancel(record, new RepostCancelledError());
    if (original === "unknown") return this.park(record, "unknown");

    let captured: CapturedListing;
    try {
      captured = await this.client.captureAd(record.listingId);
    } catch (error) {
      return this.park(record, failureKind(error));
    }
    const before = await this.currentAds();
    if (before === null) return this.park(record, "unknown");

    const attempt: CreateUnconfirmed = {
      ...record,
      title: captured.draft.title,
      reserved: captured.draft.reserved,
      thumbnailUrl: firstPhoto(captured.draft),
      idsBeforeCreate: before.map((ad) => ad.id),
      createSentAt: Date.now(),
      attempts: record.attempts + 1,
      needsUser: false,
    };
    try {
      await this.store.save(attempt);
    } catch {
      return this.park(record, "unknown");
    }
    return this.createAndConfirm(attempt, captured);
  }

  /**
   * **Old ad still to delete.** Only while the new ad answers: if the seller
   * removed the copy by hand, deleting the original would leave them with
   * nothing, so the record goes instead.
   */
  private async finishReplacing(record: OldAdToDelete): Promise<RelistOutcome> {
    const copy = await this.probe(record.newListingId);
    if (copy === "unknown") return this.park(record, "unknown");
    if (copy === "gone") {
      await this.store.clear(record.listingId);
      // The create was confirmed, so the unit stays spent; the first report wins.
      await this.report(record.grantJti, "FAILED_AFTER_DELETE");
      return { status: "failed-before-delete", error: new RepostCancelledError(), quota: null };
    }

    const deletion = await this.deleteOriginal(record.listingId);
    if (!deletion.deleted) return this.park(record, failureKind(deletion.error));
    await this.store.clear(record.listingId);
    // A resume can be the first to report, if the worker died after the create.
    return {
      status: "relisted",
      newListingId: record.newListingId,
      quota: await this.report(record.grantJti, "SUCCESS"),
    };
  }

  private async park(record: RepostRecord, reason: FailureKind): Promise<RelistOutcome> {
    try {
      await this.store.save({ ...record, failure: reason });
    } catch {
      // The old copy stays.
    }
    return { status: "unconfirmed", listingId: record.listingId, reason };
  }

  private async currentAds(): Promise<ListingSummary[] | null> {
    try {
      const page = await this.client.listMyAdsPage();
      if (page.ads.length === 0 && page.totalNumberOfResults > 0) return null;
      return page.ads;               // genuinely empty (total 0) is a real answer
    } catch (error) {
      console.warn("[relist] could not list ads", error);
      return null;
    }
  }

  /**
   * The ad a create made and lost the reply of: exactly one ad that was not in
   * the list before it and carries the same title. Only for that case — a
   * Confirmed create names its ad, and is never second-guessed by this.
   */
  private async lookForCreated(r: {
    listingId: string;
    idsBeforeCreate?: string[] | null;
    title?: string;
    draft?: CapturedAd;
  }): Promise<Landed> {
    const currentList = await this.currentAds();
    if (currentList === null) return { state: "unknown" };

    const earlier = new Set(r.idsBeforeCreate ?? []);
    const title = sameTitle(r.title ?? r.draft?.title ?? "");
    // **Never the original.** A list that was empty or lagging before the create
    // leaves it out of `earlier`, and taking it for its own copy would delete it as
    // "replaced" — the seller's only ad, gone (#189).
    const matches = currentList.filter(
      (ad) => ad.id !== r.listingId && !earlier.has(ad.id) && sameTitle(ad.title) === title,
    );

    if (matches.length === 1) return { state: "landed", id: matches[0]!.id };
    // Two new ads with this title: there is nothing to tell ours by. Never guess.
    if (matches.length > 1) return { state: "ambiguous" };
    return { state: "none" };
  }

  /**
   * Put the **Gereserveerd** flag on the ad a repost created (ADR-0028), by the
   * exact id its Confirmed create named (ADR-0041). It fails silently, and that
   * is the decision: the repost did succeed, and a flag that did not stick is not
   * a broken mechanic — so it is a log line, never `FAILED_AFTER_DELETE`.
   */
  private async reserve(listingId: string, newListingId: string): Promise<void> {
    try {
      await this.client.reserveAd(newListingId);
    } catch (error) {
      console.warn(`[relist] ${listingId} was reserved; ${newListingId} could not be`, error);
    }
  }

  // ==========================================================================
  // ADR-0003's delete-first snapshots, drained (ADR-0041)
  //
  // A seller who updates with one of these pending has an ad that is gone from
  // Marktplaats, and this snapshot is its only copy. They are finished as before
  // and never written in this shape again; this path and `unlimitedStorage` go
  // together in a later release.
  // ==========================================================================

  /**
   * A `captured` snapshot: the delete may or may not have run. An ad Marktplaats
   * still serves is cancelled and its unit refunded; one that answers `410 Gone`
   * is recreated; anything else waits (ADR-0039).
   */
  private async legacyResumeCaptured(snapshot: AdSnapshot, force: boolean): Promise<RelistOutcome> {
    const waiting: RelistOutcome = { status: "unconfirmed", listingId: snapshot.listingId, reason: "unknown" };
    if (!force && (snapshot.nextCheckAt ?? 0) > Date.now()) return waiting;

    const presence = await this.probe(snapshot.listingId);
    if (presence === "gone") {
      const deleted: AdSnapshot = { ...snapshot, phase: "deleted" };
      await this.store.save(deleted);
      return this.legacyRecreate(deleted, force);
    }
    if (presence === "exists") return this.cancel(snapshot, new RepostCancelledError());

    const checks = (snapshot.checks ?? 0) + 1;
    await this.store.save({
      ...snapshot,
      checks,
      nextCheckAt: Date.now() + CHECK_BACKOFF_MS[Math.min(checks - 1, CHECK_BACKOFF_MS.length - 1)]!,
    });
    return waiting;
  }

  /** A `deleted` snapshot: the ad is gone, and only its stored copy can bring it back. */
  private async legacyRecreate(snapshot: AdSnapshot, explicit: boolean): Promise<RelistOutcome> {
    if (snapshot.idsBeforeCreate) {
      const found = await this.lookForCreated(snapshot);
      if (found.state === "landed") return this.legacyFinish(snapshot, found.id);
      if (found.state === "ambiguous") return this.park({ ...snapshot, needsUser: true }, "unknown");
      if (found.state === "unknown" || !settled(snapshot.createSentAt, CREATE_WINDOW_MS)) {
        return this.park(snapshot, "unknown");
      }
      if (!explicit && (snapshot.attempts ?? 0) >= MAX_CREATE_ATTEMPTS) {
        return this.park({ ...snapshot, needsUser: true }, "unknown");
      }
    }

    // `[]` is somebody whose only ad this was, and parking that one would leave
    // it deleted for good; `null` is a list that could not be read.
    const before = await this.currentAds();
    if (before === null) return this.park(snapshot, "unknown");

    const attempt: AdSnapshot = {
      ...snapshot,
      idsBeforeCreate: before.map((listing) => listing.id),
      totalBefore: before.length,
      needsUser: false,
      createSentAt: Date.now(),
      attempts: (snapshot.attempts ?? 0) + 1,
    };
    try {
      await this.store.save(attempt);
    } catch {
      return this.park(snapshot, "unknown");
    }

    let newId: string;
    try {
      newId = await this.client.createAd(snapshot.draft, snapshot.photos);
    } catch (error) {
      if (!(error instanceof CreateNotConfirmedError)) {
        const found = await this.lookForCreated(attempt);
        if (found.state === "landed") return this.legacyFinish(attempt, found.id);
      }
      try {
        await this.store.save({ ...attempt, needsUser: sendingAgainCannotFix(error), failure: failureKind(error) });
      } catch { /* the previous copy is still on disk */ }
      return {
        status: "failed-recoverable", listingId: attempt.listingId, error,
        quota: await this.report(attempt.grantJti, "FAILED_AFTER_DELETE"),
      };
    }
    return this.legacyFinish(attempt, newId);
  }

  private async legacyFinish(snapshot: AdSnapshot, newId: string): Promise<RelistOutcome> {
    await this.store.clear(snapshot.listingId);
    if (snapshot.draft.reserved) await this.reserve(snapshot.listingId, newId);
    return { status: "relisted", newListingId: newId, quota: await this.report(snapshot.grantJti, "SUCCESS") };
  }
}

function firstPhoto(draft: CapturedAd): string | undefined {
  return draft.gallery?.imageUrls?.[0];
}

function isLegacy(record: RepostRecord): record is AdSnapshot {
  return record.phase === "captured" || record.phase === "deleted";
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
  if (error instanceof SpikePendingError || error instanceof DraftUnusableError) return true;
  // A chain that stopped at payment stops there every time (ADR-0041).
  if (error instanceof CreateNotConfirmedError) return error.paymentRequired;
  if (!(error instanceof ApiRequestError)) return false;
  const passing = [401, 403, 408, 429];
  return error.status >= 400 && error.status < 500 && !passing.includes(error.status);
}

/**
 * A title as Marktplaats stores it. It trims the title on create, so the ad a
 * repost makes from "Bandrecorder 2 " is called "Bandrecorder 2"; compared as
 * captured, the repost never found its own ad, parked, and was posted again by
 * every retry. Inner runs are collapsed too, so a second normalisation of the
 * same kind cannot do it again.
 */
function sameTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}
