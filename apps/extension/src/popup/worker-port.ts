import type { DisplayStateAnswer } from "../api/display-state";
import type { HandoffAnswer, PlansAnswer } from "../api/subscribing";
import type { ListingSummary } from "../domain/types";
import type { BackgroundRequest, BackgroundResponse, WireRelistOutcome } from "../background/messages";
import { fromWireError } from "../content/messages";
import type { WorkerPort } from "./screen";

/**
 * The real `WorkerPort`: `chrome.runtime` messaging, and the one place the popup
 * knows there is a worker at all.
 *
 * **A worker that does not answer is `unavailable`, not an exception.** The popup
 * has a screen for "we could not find out", and it is the same screen a backend
 * that is down produces — which is right, because from the user's chair they are
 * the same event. Sign-in and sign-out do throw: they are things a person just
 * asked for, and a failure to do them is news.
 */
export function workerPort(): WorkerPort {
  return {
    async displayState(): Promise<DisplayStateAnswer> {
      try {
        return await ask({ kind: "display-state" });
      } catch {
        return { status: "unavailable" };
      }
    },
    /**
     * Unlike the display state, a failure here is raised rather than flattened:
     * the popup has different words for a missing marktplaats.nl tab and a
     * Marktplaats that refused the request, and both are things the user can act
     * on. The typed error survives the boundary through `fromWireError`.
     */
    async ads(): Promise<ListingSummary[]> {
      return ask({ kind: "list-ads" });
    },
    async relist(listingId: string): Promise<WireRelistOutcome> {
      return ask({ kind: "relist", listingId });
    },
    async retry(listingId: string): Promise<WireRelistOutcome> {
      return ask({ kind: "retry", listingId });
    },
    /**
     * Flattened to "no wait" when the worker cannot say, like the display state
     * and unlike the two above: this number only decides whether a countdown is
     * drawn, and a popup that refused to start a relist because it could not find
     * out how long the wait was would be worse than one that shows none.
     */
    async msBeforeNextRelist(): Promise<number> {
      try {
        return await ask({ kind: "pace" });
      } catch {
        return 0;
      }
    },
    /**
     * Flattened to `unavailable` like the display state: a worker that cannot
     * answer and a backend that cannot answer are the same event from the user's
     * chair, and the plans screen has one line for both.
     */
    async plans(): Promise<PlansAnswer> {
      try {
        return await ask({ kind: "plans" });
      } catch {
        return { status: "unavailable" };
      }
    },
    /**
     * The tab is opened by the worker, so what comes back here is only ever news
     * about a Stripe page that did *not* open — and often nothing comes back at
     * all, because the popup is gone by then. Flattened for the same reason as
     * above: there is no screen for an exception, and "we couldn't open it" is
     * true of a worker that failed as much as of a Stripe that did.
     */
    async checkout(tierCode: string): Promise<HandoffAnswer> {
      try {
        return await ask({ kind: "checkout", tierCode });
      } catch {
        return { status: "unavailable" };
      }
    },
    async portal(): Promise<HandoffAnswer> {
      try {
        return await ask({ kind: "portal" });
      } catch {
        return { status: "unavailable" };
      }
    },
    async signIn(): Promise<void> {
      await ask({ kind: "sign-in" });
    },
    async signOut(): Promise<void> {
      await ask({ kind: "sign-out" });
    },
  };
}

async function ask<K extends BackgroundRequest["kind"]>(
  request: Extract<BackgroundRequest, { kind: K }>,
): Promise<BackgroundAnswerFor<K>> {
  const response = (await chrome.runtime.sendMessage(request)) as
    | BackgroundResponse<K>
    | undefined;
  if (!response) throw new Error("The extension's background worker did not answer.");
  if (!response.ok) throw fromWireError(response.error);
  return response.answer;
}

type BackgroundAnswerFor<K extends BackgroundRequest["kind"]> = Extract<
  BackgroundResponse<K>,
  { ok: true }
>["answer"];
