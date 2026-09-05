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
 * The outcome the worker answered with, as a row.
 *
 * The two failures are not the same event and the copy says so plainly, because
 * the user's next move differs: one leaves their ad exactly where it was, and the
 * other has already deleted it and is holding the only copy. **"It is saved in the
 * extension" is the sentence that has to be there** — an ad that vanished from
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
        message: `Nothing was reposted — your ad is untouched. ${describeAdsFailure(
          fromWireError(outcome.error),
        )}`,
      };
    case "failed-recoverable":
      return {
        kind: "failed",
        tone: "warn",
        action: "retry",
        message: `Your ad was removed but posting it again failed. It is saved in the extension — press Retry. ${describeAdsFailure(
          fromWireError(outcome.error),
        )}`,
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
export const PACING_NOTE = "Waiting a moment before this one, so your reposts look like clicks rather than a script.";

/**
 * What a refusal says on the row, **provisionally**.
 *
 * The designed version of each of these is T32 (#41): the header's quota, a "See
 * plans" prompt beside an exhausted one, a live countdown on a cooldown, and the
 * Portal link on a failing card. What is here is one sentence each, so that a
 * refusal is legible now rather than a button that silently does nothing — the
 * canvas's QuotaExhausted, Cooldown and Dunning artboards are that ticket's.
 */
export function refusalNote(locked: LockedState): string {
  switch (locked.state) {
    case "upgrade":
      return "You have used your relists for this period.";
    case "cooldown":
      return locked.retryAfter === null
        ? "Give Marktplaats a moment before reposting again."
        : `Give Marktplaats a moment — reposting again in ${locked.retryAfter}s.`;
    case "not-in-plan":
      // Names the capability rather than the plan: "upgrade to Pro" is a sentence
      // about our pricing, and this one is about what the user just tried to do.
      return "Reposting several at once isn’t part of your plan.";
    case "update-card":
      return "Your payment didn’t go through, so reposting is paused.";
    case "retry":
      return "Couldn’t check your plan, so nothing was reposted. Try again.";
  }
}

/** The tone the button takes while a refusal is showing — a lock, or a clock. */
export function refusedTone(locked: LockedState): "locked" | "cooldown" {
  return locked.state === "cooldown" ? "cooldown" : "locked";
}
