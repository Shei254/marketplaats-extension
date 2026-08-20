import type { DisplayStateAnswer } from "../api/display-state";
import type { ListingSummary } from "../domain/types";
import type { BackgroundRequest, BackgroundResponse } from "../background/messages";
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
