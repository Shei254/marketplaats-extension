import type { HandoffAnswer } from "../api/subscribing";

/**
 * Opening a tab, as the one thing the worker needs from Chrome to hand somebody
 * over to Stripe (T52, #83).
 *
 * A parameter rather than a direct `chrome.tabs.create`, so that what is worth
 * asserting can be: that a tab is opened for a URL and for nothing else. The
 * failure this is written against is quiet — a `gone` or an `unavailable` carries
 * no `url`, and a version of this that reached for one anyway would open
 * `chrome-extension://…/undefined` in front of somebody who had just clicked
 * Upgrade, with no error anywhere.
 */
export type OpenTab = (url: string) => Promise<unknown>;

/**
 * Send the browser to Stripe, if there is anywhere to send it, and answer what
 * happened either way.
 *
 * **The opening happens in the worker rather than wherever asked**, because a
 * Chrome popup is destroyed the moment the new tab takes focus — so the surface
 * that asked is usually gone before this answer gets back to it, which is expected
 * rather than a failure (ADR-0017: `apps/web`'s success page is what catches the
 * user). A refusal is the case where the caller *is* still there, and it is the
 * case that has something to say.
 */
export async function openStripePage(
  handoff: Promise<HandoffAnswer>,
  open: OpenTab,
): Promise<HandoffAnswer> {
  const answer = await handoff;
  if (answer.status === "opened") await open(answer.url);
  return answer;
}
