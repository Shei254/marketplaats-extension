import type { DisplayStateAnswer } from "../api/display-state";
import type { HandoffAnswer, PlansAnswer } from "../api/subscribing";
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
  | { kind: "retry"; listingId: string }
  /**
   * How long the worker will wait before the next relist actually starts (T46,
   * #54). Asked, not told: the worker does the waiting whoever calls it, and this
   * is only so a surface can show a countdown instead of a button that looks
   * stuck. Both read the same stored deadline, so the number on the screen is the
   * one being waited out rather than a second draw.
   */
  | { kind: "pace" };

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

/**
 * Subscribing, all three of it (T52, #83): what is on sale, buying one of them,
 * and managing one already bought.
 *
 * **The worker opens the tab, not the popup**, which is the whole reason the last
 * two are requests rather than a URL handed back to be opened by whoever asked.
 * A Chrome popup is destroyed the moment another surface takes focus, so the page
 * that asked for a Checkout session is gone before the tab it asked for finishes
 * opening — and a `chrome.tabs.create` awaited in a page that no longer exists is
 * the same shape of bug as a sign-in awaited there (ADR-0010). It is also the rule
 * `Popup.tsx` already keeps: nothing in the popup talks to Chrome.
 */
export type SubscribingRequest =
  | { kind: "plans" }
  | { kind: "checkout"; tierCode: string; interval: string }
  | { kind: "portal" };

export type BackgroundRequest =
  | RelistRequest
  | AuthRequest
  | DisplayStateRequest
  | AdsRequest
  | SubscribingRequest;

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
  /** Milliseconds, and 0 when a relist may start now. */
  pace: number;
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
  /** What can be bought — never the free tier and never a draft (ADR-0019). */
  plans: PlansAnswer;
  /**
   * Whether a Stripe page was opened, and what stopped it if not. The `url` rides
   * along on `opened` even though the worker has already used it: the popup does
   * not read it, and the caller that will one day want it — a live-testing hook,
   * an injected surface — should not need a second request shape to see it.
   */
  checkout: HandoffAnswer;
  portal: HandoffAnswer;
}

export type BackgroundResponse<K extends BackgroundRequest["kind"] = BackgroundRequest["kind"]> =
  | { ok: true; answer: BackgroundAnswers[K] }
  | { ok: false; error: WireError };

export function toWireOutcome(outcome: RelistOutcome): WireRelistOutcome {
  if (outcome.status === "relisted" || outcome.status === "refused") return outcome;
  return { ...outcome, error: toWireError(outcome.error) };
}
