import type { DisplayState } from "@mprelist/contracts";

import type { DisplayStateAnswer } from "../api/display-state";

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
 */
export type Screen =
  | { screen: "loading" }
  | { screen: "signed-out"; failure?: string }
  | { screen: "unavailable" }
  | { screen: "signed-in"; plan: DisplayState };

export const LOADING: Screen = { screen: "loading" };

/**
 * One answer, one screen. Pure, and total over the three answers, so a fourth
 * would not compile rather than falling through to whatever was on the screen.
 */
export function screenFor(answer: DisplayStateAnswer): Screen {
  switch (answer.status) {
    case "ready":
      return { screen: "signed-in", plan: answer.plan };
    case "signed-out":
      return { screen: "signed-out" };
    case "unavailable":
      return { screen: "unavailable" };
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
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
