import type { LockedState } from "../gate/authorization-gate";
import type { WireRelistOutcome } from "../background/messages";
import { fromWireError } from "../content/messages";
import { describeAdsFailure } from "./ads";

/**
 * What one row is doing (T30b, #79).
 *
 * The four states are the POC popup's, and so is the copy — this is a port into
 * React, not a redesign. The fifth is new: since T26 (#35) the worker can answer
 * that the backend refused, which is a row that never ran rather than one that
 * failed, and the difference is the whole of what the user should do next.
 */
export type RowState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done" }
  /** `action` is what the button retries with: a fresh relist, or a resume from the snapshot. */
  | { kind: "failed"; message: string; tone: "error" | "warn"; action: "relist" | "retry" }
  | { kind: "refused"; locked: LockedState };

export const IDLE: RowState = { kind: "idle" };

/**
 * The two sentences a failed repost says (T74, #161).
 *
 * They were once duplicated by hand for bulk repost, and the copies drifted: one
 * said *"opnieuw plaatsen"* while the other said *"herplaatsen"*, so the popup gave
 * the act two names. One word for the thing users press is the whole of that
 * ticket, and a word can only be one if the sentence carrying it is.
 *
 * **`AD_IS_DOWN` is the most important string in this product.** An ad that
 * vanished from Marktplaats with no explanation is the worst thing we can do to
 * somebody, and "De advertentie is opgeslagen in de extensie" is the only place
 * the user is told the snapshot (ADR-0003) is why it has not.
 *
 * Both are the prefix rather than the whole message: the row appends what
 * actually failed.
 */
export const AD_UNCHANGED = "Er is niets herplaatst — je advertentie is ongewijzigd.";

export const AD_IS_DOWN =
  "Je advertentie is verwijderd, maar herplaatsen is mislukt. " +
  "De advertentie is opgeslagen in de extensie — klik op Opnieuw.";

/**
 * The outcome the worker answered with, as a row.
 *
 * The two failures are not the same event and the copy says so plainly, because
 * the user's next move differs: one leaves their ad exactly where it was, and the
 * other has already deleted it and is holding the only copy. **"De advertentie is
 * opgeslagen in de extensie" is the sentence that has to be there** — an ad that vanished from
 * Marktplaats with no explanation is the worst thing this product can do to
 * somebody, and the snapshot (ADR-0003) is the reason it has not.
 */
export function rowStateFor(outcome: WireRelistOutcome): RowState {
  switch (outcome.status) {
    case "relisted":
      return { kind: "done" };
    case "refused":
      return { kind: "refused", locked: outcome.locked };
    case "failed-before-delete":
      return {
        kind: "failed",
        tone: "error",
        action: "relist",
        message: `${AD_UNCHANGED} ${describeAdsFailure(fromWireError(outcome.error))}`,
      };
    case "failed-recoverable":
      return {
        kind: "failed",
        tone: "warn",
        action: "retry",
        message: `${AD_IS_DOWN} ${describeAdsFailure(fromWireError(outcome.error))}`,
      };
  }
}

/**
 * What a deliberate wait says (T46, #54).
 *
 * It has to say *why*, not just that: a button counting down with no explanation
 * reads as the extension being slow or broken, and the fourth thing the ticket
 * asks for is that the user can tell a wait apart from a hang. And the reason is
 * true and is theirs — ADR-0008 paces relists because a run of them arriving as
 * fast as a worker can loop is machine-shaped against *their* Marktplaats
 * account, which is the account that gets flagged.
 */
export const PACING_NOTE =
  "Even wachten voor deze, zodat je herplaatsingen op klikken lijken en niet op een script.";

/**
 * What a refusal says on the row.
 *
 * **It stopped being provisional with T32 (#41).** The designed treatments the
 * first version of this deferred are all on the screen above the list now: the
 * header's quota, a "Bekijk abonnementen" prompt beside a spent period, a live
 * countdown on a cooldown, the Portal link on a failing card. What stays here is
 * one sentence per reason, on the row the attempt was made from — a prompt at the
 * top of the screen cannot say which ad it is about.
 *
 * @param grantsNothing whether the plan grants no reposts at all — `plans.ts`'s
 * `grantsNothing`, read off `/api/me` rather than off the refusal, for the reason
 * the `upgrade` case gives. A trailing boolean the way `grantLine` already takes
 * `paymentFailing`, and for the same reason: what this needs is one fact about the
 * plan, and handing it the whole `DisplayState` would invite it to start reading
 * numbers it has no business in
 */
export function refusalNote(locked: LockedState, grantsNothing: boolean): string {
  switch (locked.state) {
    case "upgrade":
      // **The discriminator is the plan, and the denial is not asked.** `upgrade`
      // carries a `resetAt` and a tier granting 0 has a real one — the period
      // still rolls, it just rolls to 0 — so nothing in the payload tells "you
      // have spent this period's reposts" from "this plan has none to spend".
      // Both are one refusal to the backend and two different things to say.
      //
      // Splitting the copy is the move `not-in-plan` already makes below: the
      // other sentence is true about something else, and showing it here answers
      // a question nobody asked. The one it replaces was worse than irrelevant —
      // it named a limit that was never reached, on a plan where nothing comes
      // back next period either.
      return grantsNothing
        ? "Dit abonnement bevat geen herplaatsingen."
        : "Je hebt je limiet voor herplaatsingen in deze periode bereikt.";
    case "cooldown":
      return locked.retryAfter === null
        ? "Geef Marktplaats even de tijd voordat je opnieuw herplaatst."
        : `Geef Marktplaats even de tijd — opnieuw herplaatsen over ${locked.retryAfter}s.`;
    case "not-in-plan":
      // Names the capability rather than the plan: "upgrade to Pro" is a sentence
      // about our pricing, and this one is about what the user just tried to do.
      return "Meerdere tegelijk herplaatsen hoort niet bij je abonnement.";
    case "update-card":
      return "Je betaling is niet gelukt, dus herplaatsen is gepauzeerd.";
    case "no-tier":
      // Says what happened and that waiting is the whole of what there is to do —
      // which is the sentence the code was added to make sayable (T77, ADR-0032).
      // No "try again": nothing is down and no retry changes the answer.
      return "Er staat nu geen abonnement op dit account, dus herplaatsen is gepauzeerd.";
    case "retry":
      return "Je abonnement kon niet worden gecontroleerd, dus er is niets herplaatst. Probeer het opnieuw.";
  }
}

/** The tone the button takes while a refusal is showing — a lock, or a clock. */
export function refusedTone(locked: LockedState): "locked" | "cooldown" {
  return locked.state === "cooldown" ? "cooldown" : "locked";
}
