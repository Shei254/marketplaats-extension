import type { DisplayStateAnswer } from "../api/display-state";
import type { AuthState } from "../auth/session";
import type { RelistOutcome } from "../domain/relist-orchestrator";
import { toWireError, type WireError } from "../content/messages";

/**
 * Wire protocol for popup → background service worker.
 *
 * The popup never runs a relist itself: its page is torn down the moment the user
 * clicks away, which under delete-first (ADR-0003) could kill the flow between the
 * delete and the re-create. **Sign-in is in the worker for the same reason and
 * more sharply** — `launchWebAuthFlow` opens a window, which takes focus, which
 * closes the popup; a flow awaited in a page that no longer exists never resolves.
 * The popup only ever asks the worker to act.
 */
export type RelistRequest =
  | { kind: "relist"; listingId: string }
  | { kind: "retry"; listingId: string };

export type AuthRequest = { kind: "sign-in" } | { kind: "sign-out" } | { kind: "auth-state" };

/**
 * What the popup renders after signing in — asked of the worker rather than
 * fetched here, because the worker holds the token and will hold the one cached
 * copy N injected buttons read (#51, T42).
 */
export type DisplayStateRequest = { kind: "display-state" };

export type BackgroundRequest = RelistRequest | AuthRequest | DisplayStateRequest;

/** A RelistOutcome with its `error: unknown` flattened to something serialisable. */
export type WireRelistOutcome =
  | { status: "relisted" }
  /** Nothing was removed from Marktplaats; the original ad is intact. */
  | { status: "failed-before-delete"; error: WireError }
  /** The original was deleted but re-create failed; snapshot retained for retry. */
  | { status: "failed-recoverable"; listingId: string; error: WireError };

/**
 * What each question is answered with — one table rather than a response union
 * per kind, so a new request has exactly one place to say what it returns.
 *
 * `AuthState` needs no wire form of its own: it is two plain fields and no
 * `unknown`, which is what a relist outcome's `error` is not.
 */
export interface BackgroundAnswers {
  relist: WireRelistOutcome;
  retry: WireRelistOutcome;
  "sign-in": AuthState;
  "sign-out": AuthState;
  "auth-state": AuthState;
  "display-state": DisplayStateAnswer;
}

export type BackgroundResponse<K extends BackgroundRequest["kind"] = BackgroundRequest["kind"]> =
  | { ok: true; answer: BackgroundAnswers[K] }
  | { ok: false; error: WireError };

export function toWireOutcome(outcome: RelistOutcome): WireRelistOutcome {
  if (outcome.status === "relisted") return outcome;
  return { ...outcome, error: toWireError(outcome.error) };
}
