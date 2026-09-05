import type { DisplayStateAnswer } from "../api/display-state";
import type { HandoffAnswer, PlansAnswer } from "../api/subscribing";
import type { AuthState } from "../auth/session";
import type { RemainingQuota } from "@mprelist/contracts";

import type { BatchRun } from "../domain/batch-run";
import type { BatchShape } from "../domain/batch-estimate";
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

/**
 * Reposting several ads as one act (T68, #147; ADR-0025).
 *
 * **Four asks and no answer that streams**, which is the shape the queue's owner
 * forces. The run belongs to the worker and is advanced by an alarm, so the popup
 * cannot be told about each ad as it happens — it is closed for most of a run, and
 * a message to a page that no longer exists goes nowhere. What it does instead is
 * ask for the run whenever it is open, which is also exactly what it has to do
 * when it opens onto a run that started before it.
 *
 * `start-batch` names the ads **in the order they will be attempted**, already
 * capped at `min(quotaRemaining, upTo)` by the surface that has both numbers. The
 * worker does not re-derive that cap and could not: `upTo` is on the plan the
 * popup rendered, and the API enforces *whether* rather than *how many*.
 */
export type BatchRequest =
  | { kind: "start-batch"; listingIds: string[] }
  | { kind: "batch-state" }
  | { kind: "stop-batch" }
  /** Forget a finished or stopped run, which is what clears the toolbar badge. */
  | { kind: "dismiss-batch" }
  /**
   * The two numbers a duration estimate is made of — the gap inside a run, and
   * the rails the API refuses on — after whatever the served config had to say
   * about them (ADR-0025).
   *
   * **Asked of the worker because the served document lives in
   * `chrome.storage.local`**, which the popup does not touch: nothing in this
   * surface talks to Chrome, and the one thing that does is the port. Without it
   * the estimate would quote the numbers this build shipped with, and an operator
   * who dropped the burst limit at 3am would have no way to stop it — which is
   * the whole reason the API serves them.
   */
  | { kind: "batch-shape" };

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
 *
 * `search-ads` is the same list filtered by Marktplaats (T31, #40) and a request
 * of its own rather than an optional `query` on the one above: the two answer
 * different screens — "you have no active ads" against "nothing matches that" —
 * and a caller that must not be trusted to leave the field off is a caller that
 * can search for the empty string.
 */
export type AdsRequest = { kind: "list-ads" } | { kind: "search-ads"; query: string };

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
  | BatchRequest
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
  /**
   * The run as the worker holds it, or `null` for an account that has none.
   *
   * It crosses whole rather than as a summary, and every field of it is already
   * serialisable — the popup renders progress, the ads that did not run, the
   * reason it stopped and the quota the last `/complete` answered with, and a
   * summary shaped for today's screen is what the next one has to widen.
   */
  "start-batch": BatchRun | null;
  "batch-state": BatchRun | null;
  "stop-batch": BatchRun | null;
  "dismiss-batch": null;
  "batch-shape": BatchShape;
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
  /** The matches, in the same shape, so one row component renders both. */
  "search-ads": ListingSummary[];
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
