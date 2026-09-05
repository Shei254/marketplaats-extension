import type { BatchBadge } from "../background/batch-runner";

/**
 * The real {@link BatchBadge}: the little label on the toolbar icon (T68, #147).
 *
 * **It is how a closed popup shows progress, and it needs no permission** —
 * which is why ADR-0025 chose it over a notification. A run is something somebody
 * walks away from, so the surface that reports it has to be one they can see
 * without opening anything, and it must not ask them for anything at install time.
 *
 * **Four characters at most**, which is what the badge will show, so what is drawn
 * is a count while a run is going and a mark once it is not. The sentence belongs
 * to the popup; this is the thing that makes somebody open it.
 */
export class ChromeToolbarBadge implements BatchBadge {
  async show(state: "running" | "finished" | "stopped", left: number): Promise<void> {
    await chrome.action.setBadgeBackgroundColor({ color: COLOURS[state] });
    await chrome.action.setBadgeText({ text: state === "running" ? String(left) : MARKS[state] });
  }

  async clear(): Promise<void> {
    await chrome.action.setBadgeText({ text: "" });
  }
}

/**
 * A tick for a run that got through its selection and an exclamation for one that
 * did not — never a number, because a stopped run's remaining count reads as
 * progress rather than as the interruption it is.
 */
const MARKS = { running: "", finished: "✓", stopped: "!" } as const;

/**
 * Green, and amber for a stop. The stop colour is deliberately not red: most of
 * the reasons a run stops are ordinary — a quota that ran out, a browser that
 * restarted — and none of them has lost the user anything, since an ad that was
 * deleted is either back or held in a snapshot with a Retry beside it.
 */
const COLOURS = { running: "#2f6feb", finished: "#1a7f37", stopped: "#9a6700" } as const;
