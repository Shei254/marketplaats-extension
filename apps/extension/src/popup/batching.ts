import { bulkIn, type DisplayState } from "@mprelist/contracts";

import { describeDuration, estimateBatchMs, sleepsMidRun, type BatchShape } from "../domain/batch-estimate";
import { progressOf, type BatchRun, type BatchStopReason } from "../domain/batch-run";
import { AD_IS_DOWN, AD_UNCHANGED, type RowState } from "./relisting";

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
   *
   * **`Infinity` where neither half caps** — an unlimited tier (ADR-0029) whose
   * flag sells no number. That is arithmetic and not a sentinel, which is the
   * distinction ADR-0029 draws about `-1`: every comparison in this file is
   * *correct* on it (`min`, `>=`, `<=`, `slice`), where a large finite stand-in
   * would be a lie that bites at exactly the scale nobody tests at.
   *
   * **Three places could print it, and each is guarded separately** — the two
   * sentences ask {@link describeCap} and {@link shortCap}, which answer `null`
   * where nothing caps; {@link describeSelectAll} has no such call and asks
   * {@link Number.isFinite} itself. The first draft of this claimed the two
   * sentences were all of them, and the count over a searched list printed
   * "5 of Infinity selected" for as long as that sentence went unchecked.
   */
  cap: number;
  /** What the plan sells, for the sentence that explains a cap the quota set. */
  upTo: number | null;
}

/**
 * Whether the popup offers bulk at all (T70, #155; ADR-0027).
 *
 * **This is the screen declining to ask, and not a plan that grants nothing.**
 * Those are different facts and the popup has always drawn them differently: a
 * plan without bulk gets its boxes *disabled* beside a line pointing at Plans,
 * which is ADR-0007's conversion surface and is deliberately not an absence. Off
 * here draws none of it — no boxes, no header, no bar, and no sentence about a
 * feature nobody can reach.
 *
 * Everything underneath keeps its meaning while this is false. The entitlement
 * still grants, `authorize` still refuses `batch: true` without it, the queue
 * still runs a batch the dev hooks start, and {@link bulkFor} below still answers
 * what a plan allows — nothing asks it. Which is what makes coming back one word:
 * `Popup` takes this as a default so the suite can flip it, and the forty tests
 * that describe the screen go on passing while no user can see it.
 *
 * Withdrawn for go-live scope rather than for any fault, and T70 is the ticket
 * that puts it back — after go-live is stable, and after slice E has been walked
 * against real ads.
 */
export const BULK_OFFERED = false;

/**
 * What this plan allows, read from the entitlement `/api/me` rendered.
 *
 * `null` means the plan does not include bulk at all — which is what draws the
 * checkboxes disabled beside a line pointing at Plans. Drawn rather than hidden,
 * deliberately: a locked control next to somebody's own ads is ADR-0007's
 * conversion surface applied one screen further in, and it is the difference
 * between a feature a free user knows to want and one they never learn exists.
 *
 * **What the flag says is `bulkIn`'s to read rather than this file's** (T69, #153;
 * ADR-0026). The same object is read by the API in Java and written by an operator
 * in `/admin`, and the two rules that used to live here — absent, `null` and
 * `false` are not a grant, and a number is read only from `{"upTo": N}` — are said
 * once in `@mprelist/contracts` for all three. A flag carrying no readable number
 * is still a grant, capped by the quota alone: the API said yes, which is the half
 * it owns, and refusing the feature over a value this screen did not recognise
 * would be second-guessing a permission it did not issue.
 *
 * **What stays here is the quota**, which is the half nothing else can know: the
 * cap is `min(quotaRemaining, upTo)`, and the second number is one `/api/me`
 * reports rather than one the plan sells.
 *
 * **An unlimited tier drops out of that `min`** (T73, ADR-0029): a period with no
 * ceiling cannot be the smaller of the two, so what the plan sells is the whole of
 * the cap — and where it sells no number either, nothing caps the selection but
 * the list itself.
 */
export function bulkFor(plan: DisplayState): BulkSelection | null {
  const grant = bulkIn(plan.features);
  if (!grant.granted) return null;
  const { upTo } = grant;
  const left = plan.quotaRemaining ?? Number.POSITIVE_INFINITY;
  return { cap: upTo === null ? left : Math.min(left, upTo), upTo };
}

/**
 * As many of these ads as the cap allows, top down. An `Infinity` cap takes them
 * all, which is what `slice` does with it and what an uncapped selection means.
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
 * Which of the two numbers in the cap is the one doing the stopping, or neither.
 *
 * Asked in one place and answered in one place, because the two sentences built on
 * it — the long one under the button and the short one in the header — have to
 * agree about which number is biting or they are two screens describing different
 * accounts. {@link CAPPED_BY} carries the wording of both for the same reason.
 *
 * `null` is an unlimited tier whose flag sells no number (ADR-0029): the cap is
 * `Infinity`, nothing is stopping anything, and there is no sentence to say.
 */
function whatCaps(bulk: BulkSelection): "plan" | "quota" | null {
  if (bulk.upTo !== null && bulk.cap >= bulk.upTo) return "plan";
  return Number.isFinite(bulk.cap) ? "quota" : null;
}

/**
 * Why the boxes stopped ticking, as a sentence — and it is a different sentence
 * depending on which of the two numbers ran out, because only one of them is
 * something a bigger plan fixes.
 *
 * `null` where neither ran out. Every caller here asks this before drawing rather
 * than after deciding a cap bit, so an unbounded selection cannot reach a screen
 * as a number.
 */
export function describeCap(bulk: BulkSelection): string | null {
  const cause = whatCaps(bulk);
  return cause === null ? null : CAPPED_BY[cause].long(bulk);
}

/**
 * The two ways of saying each cause, side by side.
 *
 * **A table rather than the same switch written twice**, because the pair under one
 * key is the thing that has to agree: the long sentence under the button and the
 * short one in the header describe the same number biting, and when they lived in
 * two functions a hundred lines apart, keeping them saying the same thing was
 * nobody's job. {@link whatCaps} already made the *decision* one; this makes the
 * wording one.
 */
const CAPPED_BY = {
  plan: {
    long: (bulk: BulkSelection) => `Je abonnement herplaatst er ${bulk.upTo} tegelijk.`,
    short: (bulk: BulkSelection) => `${bulk.upTo} tegelijk`,
  },
  quota: {
    long: () => "Meer herplaatsingen heb je deze periode niet.",
    short: (bulk: BulkSelection) => `${bulk.cap} over`,
  },
} as const;

/**
 * Why no box on this list can be ticked at all, or nothing when they can.
 *
 * The two reasons are answered before any of the per-row ones because they are
 * true of every box on the screen: a plan without bulk and a run already going are
 * facts about the list, and a sentence about *this* ad would be answering a
 * narrower question than the user is asking.
 */
function lockedBecause(bulk: BulkSelection | null, frozen: boolean): string | null {
  if (bulk === null) return "Meerdere tegelijk herplaatsen hoort bij de betaalde abonnementen.";
  if (frozen)
    return "Er loopt een reeks — die werkt de advertenties af die waren aangevinkt bij de start.";
  return null;
}

/**
 * The tooltip on one row's box: what ticking it does, or why it will not tick
 * (T68, #147).
 *
 * **A control that has gone dead has to be able to say why, where the pointer
 * already is.** The header says the cap out loud before anybody meets it; this is
 * for the person who met it anyway and is now hovering the one box that will not
 * respond. The answers are deliberately different from each other — a bigger plan
 * fixes one, the period rolling fixes another, and the third fixes itself when the
 * run ends — because "you can't" alone leaves the user with nothing to do.
 */
export function describeTick(
  bulk: BulkSelection | null,
  frozen: boolean,
  ticked: boolean,
  /** The cap is spent on *other* rows — a ticked box can always be unticked. */
  full: boolean,
): string {
  const locked = lockedBecause(bulk, frozen);
  if (locked !== null) return locked;
  if (ticked) return "Aangevinkt — deze advertentie zit in de volgende reeks. Klik om hem over te slaan.";
  if (full && bulk !== null) {
    const why = describeCap(bulk);
    // A cap that is not capping has nothing to say, and the ordinary sentence is
    // the true one — a box on an uncapped selection can always be ticked.
    if (why !== null) return why;
  }
  return "Herplaats deze advertentie samen met de andere in één reeks.";
}

/**
 * The tooltip on the Select all box, which has one thing more to explain than a
 * row's does: how many rows pressing it would actually leave ticked.
 *
 * That number is the cap and the screen at once — ten on a plan that reposts ten,
 * two on a list showing two — and it is the honest answer to the question a
 * checkbox over a list of forty ads raises and cannot answer by itself.
 */
export function describeSelectAllTick(
  bulk: BulkSelection | null,
  frozen: boolean,
  /** Everything within reach is already ticked, so pressing it clears instead. */
  all: boolean,
  /** What Select all could leave ticked — the rows on screen, or the cap. */
  reach: number,
): string {
  const locked = lockedBecause(bulk, frozen);
  if (locked !== null) return locked;
  const why = bulk === null ? null : describeCap(bulk);
  if (bulk !== null && bulk.cap === 0 && why !== null) return why;
  if (reach === 0) return "Er zijn hier geen advertenties om te selecteren.";
  if (all) return "Vink alle rijen uit.";
  return reach === 1
    ? "Vink de enige advertentie hier aan en herplaats deze."
    : `Vink de eerste ${reach} advertenties aan en herplaats ze in één reeks.`;
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
 * ticked — at that point the count carries the cap ("3 van 10 geselecteerd") and
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
  if (bulk === null) return { label: "Alles selecteren", hint: null };
  if (bulk.cap === 0) return { label: "Alles selecteren", hint: "Geen herplaatsingen over" };
  if (count === 0) return { label: "Alles selecteren", hint: shortCap(bulk) };
  // **The cap is only named while it can actually be met.** Two ads on a plan that
  // reposts ten are two ads: "2 van 10 geselecteerd" over a list that has ticked
  // everything it holds — beside a Select all box that is, correctly, full —
  // is three controls telling the user three different stories about the same
  // screen, and the one that invents eight more ads is the one that is wrong.
  //
  // **An unbounded cap can never be met**, so it is never named (T73, ADR-0029).
  // Asked first because the test above cannot answer it: `rowsShown <= Infinity`
  // is true of every list, so a search hiding part of the selection fell straight
  // through to the line below and read "5 van Infinity geselecteerd".
  if (!Number.isFinite(bulk.cap)) return { label: `${count} geselecteerd`, hint: null };
  if (rowsShown <= bulk.cap && count <= rowsShown) return { label: `${count} geselecteerd`, hint: null };
  return { label: `${count} van ${bulk.cap} geselecteerd`, hint: null };
}

/**
 * The cap in the four or five characters a row this wide has left for it, or
 * nothing where nothing caps — which is the one place an unbounded cap could have
 * reached a screen, as "Infinity over".
 */
function shortCap(bulk: BulkSelection): string | null {
  const cause = whatCaps(bulk);
  return cause === null ? null : CAPPED_BY[cause].short(bulk);
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
    ? "1 aangevinkte advertentie staat niet in deze resultaten — die wordt wel herplaatst."
    : `${hidden} aangevinkte advertenties staan niet in deze resultaten — die worden wel herplaatst.`;
}

/**
 * What starting the ticked rows would actually do: which ads, under what label,
 * and how long it will take.
 *
 * **The duration is said before somebody commits**, which is the condition
 * ADR-0025 attached to letting a Power batch be twenty-five: a two-hour unattended
 * run is a reasonable thing to start and an unreasonable thing to discover. The
 * pause is named separately from the length for the same reason — "ongeveer 2 uur"
 * alone reads as two hours of work, and what actually happens is a wait in the
 * middle while the burst rail slides.
 *
 * **And the cap is applied here, not only by the boxes that were ticked.** The
 * boxes enforce it at the moment of ticking, but the cap moves underneath them: a
 * single repost pressed on a row while five are ticked spends a unit, and
 * `/complete` answers with a `quotaRemaining` this screen believes immediately
 * (T32, #41). The selection does not shrink to meet it — unticking somebody's rows
 * for them would be worse — so the offer does, and says so. Anything else is a
 * button whose number and whose act have quietly stopped matching.
 */
export function offerSelection(chosen: readonly string[], bulk: BulkSelection, shape: BatchShape): BatchOffer | null {
  if (chosen.length === 0) return null;
  const listingIds = pickUpTo(chosen, bulk.cap);
  if (listingIds.length === 0) {
    // Something has to be capping for a non-empty selection to come back empty, so
    // there is a sentence; a bar with no offer and no reason on it would not be one.
    const why = describeCap(bulk);
    return why === null ? null : { kind: "blocked", why };
  }
  const long = describeDuration(estimateBatchMs(listingIds.length, shape.gap, shape.rails));
  return {
    kind: "repost",
    listingIds,
    // "2 van 5" and not "2": the rows that will not run this time are still ticked
    // and still on screen, and a button that counted only the ones it was taking
    // would be silently dropping three ads the user can see they chose.
    label:
      listingIds.length < chosen.length
        ? `Herplaats ${listingIds.length} van ${chosen.length} geselecteerd · ${long}`
        : `Herplaats ${chosen.length} geselecteerd · ${long}`,
    note: sleepsMidRun(listingIds.length, shape.rails)
      ? "Halverwege wordt er gepauzeerd — Marktplaats staat maar een beperkt aantal herplaatsingen per uur toe."
      : null,
  };
}

/**
 * What a stopped run offers to do about the ads it never reached: start again over
 * the front of them, or say why it cannot.
 *
 * **The cap is applied here because this is a start and not a selection**, and it
 * is the only start that does not come through the boxes. Those stop ticking at
 * `min(quotaRemaining, upTo)`; this offer never touches them, so without the same
 * number it would happily start twenty-two ads against two remaining relists —
 * twenty authorizes the gate refuses one after another, each costing an attempt
 * and a wait, and the first of them deleting an ad before the refusals begin. A
 * cap enforced in one of the two places it can be reached is not a cap.
 *
 * The ads offered are the front of the queue rather than a fresh choice: they are
 * already in the order the user picked them, and re-choosing on their behalf is
 * the one thing this screen has never done.
 */
export function offerUnstarted(run: BatchRun | null, bulk: BulkSelection | null): BatchOffer | null {
  const unstarted = run?.stop?.unstarted ?? [];
  // A finished run has nothing left over, and a plan without bulk has no bar at
  // all — the line pointing at Plans stands in its place, and a run's leftovers
  // are not reachable from there.
  if (unstarted.length === 0 || bulk === null) return null;
  const listingIds = pickUpTo(unstarted, bulk.cap);
  if (listingIds.length === 0) {
    const why = describeCap(bulk);
    return why === null ? null : { kind: "blocked", why };
  }
  return listingIds.length < unstarted.length
    ? {
        kind: "repost",
        listingIds,
        label: `Herplaats ${listingIds.length} van de resterende ${unstarted.length}`,
        note: describeCap(bulk),
      }
    : { kind: "repost", listingIds, label: `Herplaats de resterende ${unstarted.length}`, note: null };
}

/**
 * What a start would be, or the reason there is none — the same two states for
 * both ways into a run, because they are the same question asked of a different
 * list of ads.
 *
 * Two states rather than a button with an empty list beside it: what can be
 * started and whether anything can are the same fact, and carrying them as two
 * fields is two fields that can disagree about it.
 */
export type BatchOffer =
  /** These ads, now, under this label — the button the bar draws. */
  | { kind: "repost"; listingIds: string[]; label: string; note: string | null }
  /** Ads were left over and the plan can start none of them yet, and this is why. */
  | { kind: "blocked"; why: string };

/** "3 van 5 herplaatst" while a run is going, and after it has stopped. */
export function describeProgress(run: BatchRun): string {
  const { attempted, total, reposted } = progressOf(run);
  return run.stop === null
    ? `Bezig met herplaatsen ${Math.min(attempted + 1, total)} van ${total}…`
    : `${reposted} van ${total} herplaatst.`;
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
      return "Gestopt.";
    case "browser-restart":
      return "Chrome is opnieuw gestart terwijl dit liep, dus de rest is niet uitgevoerd in plaats van zonder jou door te gaan.";
    case "quota":
      return "Je hebt je limiet voor herplaatsingen in deze periode bereikt, dus de rest is niet gestart.";
    case "dunning":
      return "Je betaling is niet gelukt, dus de rest is niet gestart.";
    case "not-in-plan":
      return "Meerdere tegelijk herplaatsen hoort niet bij je abonnement, dus de rest is niet gestart.";
    case "unavailable":
      return "Je abonnement kon niet worden gecontroleerd, dus de rest is niet gestart. Probeer het opnieuw.";
    case "no-tier":
      // Deliberately without "probeer het opnieuw", unlike the line above it: the
      // backend answered, and no retry changes the answer (T77, ADR-0032).
      return "Er staat nu geen abonnement op dit account, dus de rest is niet gestart.";
    case "ad-down":
      // The one stop that is about an ad rather than about the account, and the
      // one where the user has something to do on a specific row.
      return "Eén advertentie is verwijderd en kon niet worden herplaatst, dus er is niets anders gestart. De advertentie is opgeslagen in de extensie — klik op Opnieuw bij die rij.";
    case "failures":
      return "Twee herplaatsingen achter elkaar leverden niets op, dus de rest is niet gestart. Er is niets verwijderd.";
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
      // The single-repost sentence itself, not a copy of it: the same event said
      // twice is how the two drifted apart (T74, #161). The unit went back and
      // the ad is exactly where it was.
      return { kind: "failed", tone: "error", action: "relist", message: AD_UNCHANGED };
    case "down":
      return { kind: "failed", tone: "warn", action: "retry", message: AD_IS_DOWN };
  }
}
