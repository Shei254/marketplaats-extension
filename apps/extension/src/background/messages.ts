import type { DisplayStateAnswer } from "../api/display-state";
import type { AuthState } from "../auth/session";
import type { RemainingQuota } from "@mprelist/contracts";

import type { LockedState } from "../gate/authorization-gate";
import type { RelistOutcome } from "../domain/relist-orchestrator";
import type { ListingSummary } from "../domain/types";
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

/**
 * The user's own ads. Asked of the worker rather than fetched by the popup so
 * that the relay client has one owner — and so that the popup, which is torn down
 * whenever it loses focus, is never the thing holding a request to the page.
 */
export type AdsRequest = { kind: "list-ads" };

export type BackgroundRequest = RelistRequest | AuthRequest | DisplayStateRequest | AdsRequest;

/** A RelistOutcome with its `error: unknown` flattened to something serialisable. */
export type WireRelistOutcome =
  | { status: "relisted"; quota: RemainingQuota | null }
  /** Nothing was removed from Marktplaats; the original ad is intact. */
  | { status: "failed-before-delete"; error: WireError; quota: RemainingQuota | null }
  /** The original was deleted but re-create failed; snapshot retained for retry. */
  | { status: "failed-recoverable"; listingId: string; error: WireError; quota: RemainingQuota | null }
  /**
   * The backend refused, so nothing ran (#35). It crosses as it stands: a
   * `LockedState` is a code and at most one number, and the row that renders it
   * (T30b, #79) reads the same value the gate produced rather than a second
   * spelling of it.
   */
  | { status: "refused"; locked: LockedState };

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
  /**
   * The ads themselves on success; a failure travels as the envelope's typed
   * `WireError`, so the popup can still tell "no marktplaats.nl tab" from
   * "Marktplaats refused the request" and say something different about each.
   */
  "list-ads": ListingSummary[];
}

export type BackgroundResponse<K extends BackgroundRequest["kind"] = BackgroundRequest["kind"]> =
  | { ok: true; answer: BackgroundAnswers[K] }
  | { ok: false; error: WireError };

export function toWireOutcome(outcome: RelistOutcome): WireRelistOutcome {
  if (outcome.status === "relisted" || outcome.status === "refused") return outcome;
  return { ...outcome, error: toWireError(outcome.error) };
}
