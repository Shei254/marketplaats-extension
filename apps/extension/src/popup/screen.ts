import type { DisplayState } from "@mprelist/contracts";

import type { DisplayStateAnswer } from "../api/display-state";
import type { HandoffAnswer, PlansAnswer } from "../api/subscribing";
import type { WireRelistOutcome } from "../background/messages";
import type { BatchShape } from "../domain/batch-estimate";
import type { BatchRun } from "../domain/batch-run";
import type { ListingSummary } from "../domain/types";

/**
 * What the popup is showing, and the whole of it (T29, #38).
 *
 * Four screens, one at a time. **Signed out shows only sign-in** — no ad list, no
 * quota, no plan — which is ADR-0007's refinement and not a layout preference:
 * everything else on this surface is either the user's own data or a number the
 * backend has not been asked for yet.
 *
 * `unavailable` is a screen of its own rather than an error banner over the
 * signed-in one, because the thing it must never do is show a plan. Fail-closed
 * applies to display (`docs/enforcement-contract.md`): a stale "active" over a
 * backend that is down puts a live Repost button in front of a user the gate is
 * about to refuse.
 *
 * `plans` is the conversion screen (T52, #83) and it is a screen rather than a
 * panel over the signed-in one, because it replaces everything: the ad list, the
 * strip and the prompt that sent the user here are all about the plan they have,
 * and this is the one place that is about the plans they could have. It carries
 * the current plan with it, so the card they are already on can say so without
 * asking `/api/me` a second time.
 *
 * `outdated` is the fifth, and the reason it is not folded into `unavailable` is
 * that the two ask for opposite things (T43, #52). "Unavailable" says wait and try
 * again; this one says trying again is exactly what will not work, and names the
 * one thing that will. A build the backend has stopped serving is refused on every
 * route, so there is no plan to show and no ad list worth listing.
 */
export type Screen =
  | { screen: "loading" }
  | { screen: "signed-out"; failure?: string }
  | { screen: "unavailable" }
  | { screen: "outdated" }
  | { screen: "signed-in"; plan: DisplayState }
  | { screen: "plans"; plan: DisplayState };

export const LOADING: Screen = { screen: "loading" };

/**
 * One answer, one screen. Pure, and total over the four answers, so a fifth would
 * not compile rather than falling through to whatever was on the screen.
 *
 * `PlansAnswer` shares three of those four cases, and the popup hands them here
 * for the same treatment: a plans call refused for want of a token means the same
 * thing as a display-state call refused for want of one, and answering it with a
 * different screen would be two vocabularies for one event.
 */
export function screenFor(answer: DisplayStateAnswer): Screen {
  switch (answer.status) {
    case "ready":
      return { screen: "signed-in", plan: answer.plan };
    case "signed-out":
      return { screen: "signed-out" };
    case "unavailable":
      return { screen: "unavailable" };
    case "outdated":
      return { screen: "outdated" };
  }
}

/**
 * The worker, as the popup needs it.
 *
 * A port rather than `chrome.runtime.sendMessage` at every call site: the popup's
 * routing is worth testing without a browser, and this is the seam that makes it
 * a value. The worker owns all three of these for reasons of its own — the popup
 * is destroyed the moment `launchWebAuthFlow` opens a window, and it must not be
 * the thing holding a relist (ADR-0003, ADR-0010).
 */
export interface WorkerPort {
  displayState(): Promise<DisplayStateAnswer>;
  /**
   * The user's own ads. Throws the typed error the relay raised — which one it is
   * decides what the screen says, and only the popup knows how to say it.
   */
  ads(): Promise<ListingSummary[]>;
  /**
   * The same ads, filtered by Marktplaats rather than in this window (T31, #40).
   *
   * Server-side because the list is not necessarily all of it — `listMyAds`
   * paging is an open spike (`docs/enforcement-contract.md`), and a box that
   * filtered what happened to have arrived would quietly fail to find an ad the
   * seller can see on their own dashboard.
   *
   * Throws like `ads` and for the same reason: the two fail the same ways, and
   * both failures are things the user can act on.
   */
  searchAds(query: string): Promise<ListingSummary[]>;
  /**
   * Relist an ad, or resume one the extension is holding a snapshot of. Both run
   * in the worker for the reason ADR-0003 gives — a popup closed mid-relist must
   * not strand an ad between the delete and the re-create — and both answer with
   * an outcome rather than throwing, refusals included (T26, #35).
   */
  relist(listingId: string): Promise<WireRelistOutcome>;
  retry(listingId: string): Promise<WireRelistOutcome>;
  /**
   * Repost several ads as one act (T68, #147; ADR-0025) — four asks, because the
   * run is the worker's and this surface only starts it, watches it and stops it.
   *
   * **The ads are already capped** at `min(quotaRemaining, upTo)` by the caller,
   * which is the only place both numbers exist: the plan came from `/api/me` and
   * the API enforces *whether* rather than *how many*.
   *
   * `batchState` is asked rather than pushed, and that is a property of the design
   * rather than a shortcut. The popup is closed for most of a run — a message sent
   * to a page that no longer exists goes nowhere — so the surface that can be
   * opened halfway through a run has to be able to ask what it missed, and once it
   * can do that there is nothing a push would add.
   */
  startBatch(listingIds: string[]): Promise<BatchRun | null>;
  batchState(): Promise<BatchRun | null>;
  stopBatch(): Promise<BatchRun | null>;
  /** Forget a run that has ended, which is what takes the toolbar badge down. */
  dismissBatch(): Promise<void>;
  /**
   * The gap and the rails a duration estimate is made of, after whatever the API
   * served (ADR-0025) — asked of the worker because the served document lives in
   * storage, which this surface does not touch.
   */
  batchShape(): Promise<BatchShape>;
  /**
   * How long the worker will pace before the relist it is about to be asked for
   * actually starts, in milliseconds (T46, #54).
   *
   * The popup does not enforce it — the worker waits whoever asked, and would
   * still wait if this were never called. What it is for is the fourth thing the
   * ticket asks: a deliberate wait a user can see, rather than a button that
   * says "Reposting…" for a minute and looks hung.
   */
  msBeforeNextRelist(): Promise<number>;
  /**
   * What can be bought (T49, #80) — never the free tier and never a draft, which
   * is the route's rule rather than a filter applied here.
   */
  plans(): Promise<PlansAnswer>;
  /**
   * Buy a plan at one of its rhythms: the worker opens the Stripe Checkout tab,
   * and this says whether there was one to open. The rhythm is named because a
   * tier may be sold monthly and annually (T62, #128), so a code alone names two
   * prices.
   *
   * **This promise usually never resolves in the popup**, and that is expected
   * rather than a bug: the new tab takes focus, which destroys the page awaiting
   * it (ADR-0017 — `apps/web`'s success page is what catches the user instead). So
   * the caller must put the screen into whatever state it wants a user to see
   * *before* awaiting, and treat an answer that does arrive as a refusal to render.
   */
  checkout(tierCode: string, interval: string): Promise<HandoffAnswer>;
  /**
   * Manage what is already being paid for — the card, the invoices, cancelling
   * (T21, #31). Opened and refused exactly like a Checkout, including the part
   * about this promise usually not coming back.
   */
  portal(): Promise<HandoffAnswer>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
