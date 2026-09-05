import type { DisplayState } from "@mprelist/contracts";

import { ASSUMED_RAILS, describeDuration, estimateBatchMs, sleepsMidRun } from "../domain/batch-estimate";
import { progressOf, type BatchRun, type BatchStopReason } from "../domain/batch-run";
import { BULK_PACE, type PacingWindow } from "../domain/relist-pace";
import type { RowState } from "./relisting";

/**
 * Reposting several ads at once, as the popup understands it (T68, #147;
 * ADR-0025).
 *
 * **Two halves that both live on this side of the wire.** The plan says whether
 * bulk is included and how many at a time, and the popup is the only thing that
 * can act on the second — `authorize` sees one ad at a time and has nothing to
 * count a batch with, so the API enforces *whether* and this enforces *how many*.
 * That split is ADR-0007's soft enforcement as it already stood, and the honest
 * reading of it is that the cap here is a convenience for the user rather than a
 * defence against them.
 */

/** What a plan lets somebody select, or nothing when it does not include bulk. */
export interface BulkSelection {
  /**
   * The most rows that may be ticked, which is `min(quotaRemaining, upTo)`.
   *
   * Both halves matter and for different reasons: `upTo` is what the plan sells,
   * and the quota is what the period has left — a selection of ten against two
   * remaining relists is eight ads the gate would refuse one after another, each
   * costing an attempt and a wait.
   */
  cap: number;
  /** What the plan sells, for the sentence that explains a cap the quota set. */
  upTo: number | null;
}

/**
 * What this plan allows, read from the entitlement `/api/me` rendered.
 *
 * `null` means the plan does not include bulk at all — which is what draws the
 * checkboxes disabled beside a line pointing at Plans. Drawn rather than hidden,
 * deliberately: a locked control next to somebody's own ads is ADR-0007's
 * conversion surface applied one screen further in, and it is the difference
 * between a feature a free user knows to want and one they never learn exists.
 *
 * **A flag carrying no readable number is still a grant**, capped by the quota
 * alone. The API said yes — that is the half it owns — and `{"upTo": N}` is the
 * shape the seed writes rather than a shape the contract promises; a popup that
 * refused the feature over a value it did not recognise would be second-guessing a
 * permission it did not issue.
 */
export function bulkFor(plan: DisplayState): BulkSelection | null {
  const flag = plan.features["bulk"];
  if (flag == null || flag === false) return null;
  const upTo = upToIn(flag);
  return { cap: upTo === null ? plan.quotaRemaining : Math.min(plan.quotaRemaining, upTo), upTo };
}

function upToIn(flag: unknown): number | null {
  if (typeof flag !== "object" || flag === null) return null;
  const upTo = (flag as Record<string, unknown>)["upTo"];
  return typeof upTo === "number" && Number.isInteger(upTo) && upTo > 0 ? upTo : null;
}

/**
 * As many of these ads as the cap allows, top down.
 *
 * **Top down and not "the ones nearest the cap"**, because the list is the order
 * somebody read it in: Select all on a plan that reposts ten of forty ads has to
 * mean the ten at the top, which are the ten they were already looking at. Any
 * other rule would be this screen choosing ads on the user's behalf.
 */
export function pickUpTo(listingIds: readonly string[], cap: number): string[] {
  return listingIds.slice(0, Math.max(0, cap));
}

/**
 * Which of the two numbers in the cap is the one doing the stopping.
 *
 * Asked in one place and answered in one place, because the two sentences built on
 * it — the long one under the button and the short one in the header — have to
 * agree about which number is biting or they are two screens describing different
 * accounts.
 */
function whatCaps(bulk: BulkSelection): "plan" | "quota" {
  return bulk.upTo !== null && bulk.cap >= bulk.upTo ? "plan" : "quota";
}

/**
 * Why the boxes stopped ticking, as a sentence — and it is a different sentence
 * depending on which of the two numbers ran out, because only one of them is
 * something a bigger plan fixes.
 */
export function describeCap(bulk: BulkSelection): string {
  return whatCaps(bulk) === "plan"
    ? `Your plan reposts ${bulk.upTo} at a time.`
    : "That is all the relists you have left this period.";
}

/**
 * The line over the list: what ticking everything would do, and what stops it.
 *
 * **The cap is said before it bites rather than after.** Without this line the
 * only way to learn that a plan reposts ten at a time is to tick an eleventh box
 * and find it inert — a control that goes dead with no sentence anywhere near it
 * is the shape of a bug, and it is the one thing a user cannot tell apart from
 * one. The same hole swallowed a spent quota whole: every box disabled, nothing
 * ticked, and therefore no action bar and no explanation on the screen at all.
 *
 * `hint` is the right-hand half and gives way to Clear the moment something is
 * ticked — at that point the count carries the cap ("3 of 10 selected") and
 * repeating it would be the same number twice in one row of a 360px window.
 */
export function describeSelectAll(
  count: number,
  bulk: BulkSelection | null,
  rowsShown: number,
): { label: string; hint: string | null } {
  // No bulk on the plan at all: the row is drawn and inert, like the boxes under
  // it, and the sentence that explains it is the one pointing at Plans, pinned
  // under the list. Saying anything here would be a second answer to a question
  // already answered a few pixels lower.
  if (bulk === null) return { label: "Select all", hint: null };
  if (bulk.cap === 0) return { label: "Select all", hint: "No relists left" };
  if (count === 0) return { label: "Select all", hint: shortCap(bulk) };
  // **The cap is only named while it can actually be met.** Two ads on a plan that
  // reposts ten are two ads: "2 of 10 selected" over a list that has ticked
  // everything it holds — beside a Select all box that is, correctly, full —
  // is three controls telling the user three different stories about the same
  // screen, and the one that invents eight more ads is the one that is wrong.
  if (rowsShown <= bulk.cap && count <= rowsShown) return { label: `${count} selected`, hint: null };
  return { label: `${count} of ${bulk.cap} selected`, hint: null };
}

/** The cap in the four or five characters a row this wide has left for it. */
function shortCap(bulk: BulkSelection): string {
  return whatCaps(bulk) === "plan" ? `${bulk.upTo} at a time` : `${bulk.cap} left`;
}

/**
 * The ticked ads a search is not showing, said out loud.
 *
 * **A selection survives the box being typed in**, which is what makes it possible
 * to build one across two queries — the plausible way to pick ten ads out of forty.
 * The price is that some of what is about to be reposted is off-screen, and
 * reposting deletes first (ADR-0003): a batch containing ads the user cannot see at
 * the moment they press the button is the one surprise here that cannot be undone.
 * So the number is never left to be inferred from a count that does not match the
 * boxes.
 */
export function describeHidden(hidden: number): string | null {
  if (hidden <= 0) return null;
  return hidden === 1
    ? "1 ticked ad isn’t in these results — it will still be reposted."
    : `${hidden} ticked ads aren’t in these results — they will still be reposted.`;
}

/**
 * The action bar's sentence: how many, and how long it will take.
 *
 * **The duration is said before somebody commits**, which is the condition
 * ADR-0025 attached to letting a Power batch be twenty-five: a two-hour unattended
 * run is a reasonable thing to start and an unreasonable thing to discover. The
 * pause is named separately from the length for the same reason — "about 2 hours"
 * alone reads as two hours of work, and what actually happens is a wait in the
 * middle while the burst rail slides.
 */
export function describeSelection(
  count: number,
  rails = ASSUMED_RAILS,
  gap: PacingWindow = BULK_PACE,
): { label: string; note: string | null } {
  return {
    label: `Repost ${count} selected · ${describeDuration(estimateBatchMs(count, gap, rails))}`,
    note: sleepsMidRun(count, rails)
      ? "It will pause partway — Marktplaats only tolerates so many reposts in an hour."
      : null,
  };
}

/** "3 of 5 reposted" while a run is going, and after it has stopped. */
export function describeProgress(run: BatchRun): string {
  const { attempted, total, reposted } = progressOf(run);
  return run.stop === null
    ? `Reposting ${Math.min(attempted + 1, total)} of ${total}…`
    : `${reposted} of ${total} reposted.`;
}

/**
 * Why a run is not going any more, in words about the user's situation.
 *
 * Each of these is a different next move, which is why the reasons are separate
 * codes rather than one "it stopped": a quota comes back on a date, a card needs
 * replacing, an ad that is down needs one press of Retry, and a browser restart
 * needs nothing at all except starting again.
 */
export function describeStop(reason: BatchStopReason): string | null {
  switch (reason) {
    case "finished":
      return null;
    case "stopped":
      return "Stopped.";
    case "browser-restart":
      return "Chrome restarted while this was running, so the rest was dropped rather than run without you.";
    case "quota":
      return "You have used your relists for this period, so the rest were not started.";
    case "dunning":
      return "Your payment didn’t go through, so the rest were not started.";
    case "not-in-plan":
      return "Reposting several at once isn’t part of your plan, so the rest were not started.";
    case "unavailable":
      return "Couldn’t check your plan, so the rest were not started. Try again.";
    case "ad-down":
      // The one stop that is about an ad rather than about the account, and the
      // one where the user has something to do on a specific row.
      return "One ad was removed and couldn’t be posted again, so nothing else was started. It is saved in the extension — press Retry on that row.";
    case "failures":
      return "Two reposts in a row got nowhere, so the rest were not started. Nothing was removed.";
  }
}

/**
 * What each row in a run should say, keyed by ad.
 *
 * The rows are the same rows a single repost uses, which is the point: a batch is
 * not a second relist mechanic (ADR-0025) and should not look like one. The ad
 * being attempted right now is `busy`; the rest carry whatever became of them.
 */
export function rowStatesFor(run: BatchRun | null): Record<string, RowState> {
  if (run === null) return {};
  const states: Record<string, RowState> = {};
  for (const outcome of run.outcomes) {
    states[outcome.listingId] = rowStateForOutcome(outcome.result);
  }
  if (run.stop === null) {
    const current = run.queued[run.at];
    if (current !== undefined) states[current] = { kind: "busy" };
  }
  return states;
}

function rowStateForOutcome(result: "reposted" | "skipped" | "down"): RowState {
  switch (result) {
    case "reposted":
      return { kind: "done" };
    case "skipped":
      // The wording is the single-repost one, because it is the same event: the
      // unit went back and the ad is exactly where it was.
      return {
        kind: "failed",
        tone: "error",
        action: "relist",
        message: "Nothing was reposted — your ad is untouched.",
      };
    case "down":
      return {
        kind: "failed",
        tone: "warn",
        action: "retry",
        message: "Your ad was removed but posting it again failed. It is saved in the extension — press Retry.",
      };
  }
}
