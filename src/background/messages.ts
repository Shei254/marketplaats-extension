import type { RelistOutcome } from "../domain/relist-orchestrator";
import { toWireError, type WireError } from "../content/messages";

/**
 * Wire protocol for popup → background service worker.
 *
 * The popup never runs a relist itself: its page is torn down the moment the user
 * clicks away, which under delete-first (ADR-0003) could kill the flow between the
 * delete and the re-create. The service worker owns the orchestrator (and resumes
 * interrupted relists on startup), so the popup only asks it to act.
 */
export type BackgroundRequest =
  | { kind: "relist"; listingId: string }
  | { kind: "retry"; listingId: string };

/** A RelistOutcome with its `error: unknown` flattened to something serialisable. */
export type WireRelistOutcome =
  | { status: "relisted" }
  | { status: "failed-before-delete"; error: WireError }
  | { status: "failed-recoverable"; listingId: string; error: WireError };

export type BackgroundResponse =
  | { ok: true; outcome: WireRelistOutcome }
  | { ok: false; error: WireError };

export function toWireOutcome(outcome: RelistOutcome): WireRelistOutcome {
  if (outcome.status === "relisted") return outcome;
  return { ...outcome, error: toWireError(outcome.error) };
}
