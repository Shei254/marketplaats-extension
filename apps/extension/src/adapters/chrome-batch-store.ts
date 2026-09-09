import type { RemainingQuota } from "@mprelist/contracts";

import type { BatchAdOutcome, BatchRun, BatchStop, BatchStopReason } from "../domain/batch-run";
import type { BatchStore } from "../domain/batch-store";

/**
 * The real {@link BatchStore}: one key in `chrome.storage.local`, beside the
 * session, the snapshots and the pacing deadline (T68, #147).
 *
 * **Checked on the way out, like everything else read back from storage.** Under
 * ADR-0007 the user can write this key themselves, and it outlives the build that
 * wrote it — so a document that is not one this build recognises is answered as
 * *no run at all* rather than as a run with holes in it. That answer is the safe
 * one in the only direction that matters: no run means nothing is advanced and
 * nothing is deleted, where a half-read one could name an ad the user never
 * selected.
 *
 * `unlimitedStorage` is already in the manifest for the snapshots, which carry
 * photos; a run is a few strings.
 */
const STORAGE_KEY = "batchRun";

export class ChromeBatchStore implements BatchStore {
  async read(): Promise<BatchRun | null> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return asBatchRun(stored[STORAGE_KEY]);
  }

  async write(run: BatchRun): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: run });
  }

  async clear(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEY);
  }
}

/**
 * What a stored value is worth reading as, or `null` for one that is not.
 *
 * Exported because the checking is the interesting half and deserves a suite of
 * its own; the class above is three calls to Chrome.
 */
export function asBatchRun(value: unknown): BatchRun | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;

  const queued = asListingIds(fields["queued"]);
  if (queued === null || queued.length === 0) return null;

  const at = fields["at"];
  // Past the end is a finished run and is legitimate; past the *length* is not,
  // and neither is a fraction. `at` is what indexes the queue, so a wrong one is
  // the difference between reposting the ad somebody chose and reposting another.
  if (!Number.isInteger(at) || (at as number) < 0 || (at as number) > queued.length) return null;

  const outcomes = asOutcomes(fields["outcomes"]);
  if (outcomes === null) return null;

  const misses = fields["misses"];
  if (!Number.isInteger(misses) || (misses as number) < 0) return null;

  const startedAt = fields["startedAt"];
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;

  const nextAt = fields["nextAt"];
  if (nextAt !== null && (typeof nextAt !== "number" || !Number.isFinite(nextAt))) return null;

  const stop = fields["stop"] == null ? null : asStop(fields["stop"]);
  if (stop === null && fields["stop"] != null) return null;

  // The quota is the one field whose absence is ordinary — a run nobody has
  // reported on yet has none — so an unreadable one is dropped to `null` rather
  // than taking the run with it. That is the opposite of every check above, and
  // deliberately: those decide which ad gets deleted, and this decides a number on
  // a strip that the reload at the end of a run corrects anyway.
  const quota = asRemainingQuota(fields["quota"]);

  return {
    queued,
    at: at as number,
    outcomes,
    misses: misses as number,
    stop,
    nextAt: nextAt as number | null,
    startedAt,
    quota,
  };
}

/**
 * `{ quotaRemaining, resetAt }`, or nothing — the same shape `/complete` answers
 * with, including the `null` an unlimited tier reports (T73, ADR-0029).
 */
function asRemainingQuota(value: unknown): RemainingQuota | null {
  if (typeof value !== "object" || value === null) return null;
  const { quotaRemaining, resetAt } = value as Record<string, unknown>;
  if (quotaRemaining !== null && (!Number.isInteger(quotaRemaining) || (quotaRemaining as number) < 0)) {
    return null;
  }
  if (typeof resetAt !== "string" || resetAt.length === 0) return null;
  return { quotaRemaining: quotaRemaining as number | null, resetAt };
}

function asListingIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || id.length === 0) return null;
    ids.push(id);
  }
  return ids;
}

function asOutcomes(value: unknown): BatchAdOutcome[] | null {
  if (!Array.isArray(value)) return null;
  const outcomes: BatchAdOutcome[] = [];
  for (const held of value) {
    if (typeof held !== "object" || held === null) return null;
    const { listingId, result } = held as Record<string, unknown>;
    if (typeof listingId !== "string" || listingId.length === 0) return null;
    if (result !== "reposted" && result !== "skipped" && result !== "down") return null;
    outcomes.push({ listingId, result });
  }
  return outcomes;
}

function asStop(value: unknown): BatchStop | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { reason, unstarted } = value as Record<string, unknown>;
  if (!STOP_REASONS.includes(reason as BatchStopReason)) return null;
  const ads = asListingIds(unstarted);
  return ads === null ? null : { reason: reason as BatchStopReason, unstarted: ads };
}

/**
 * The reasons this build knows, as values rather than as a type alone — a stored
 * run naming one it has never heard of is a run written by a newer build, and
 * dropping it is the same "ignore the whole document" rule the served config
 * keeps.
 */
const STOP_REASONS: readonly BatchStopReason[] = [
  "finished",
  "stopped",
  "browser-restart",
  "quota",
  "dunning",
  "not-in-plan",
  "unavailable",
  "ad-down",
  "failures",
];
