import { createRoot, type Root } from "react-dom/client";

import { grantsNothing } from "../popup/plans";
import { workerPort } from "../popup/worker-port";
import { findSlots } from "./anchors";
import { PageButtonsOnPage } from "./page";

/**
 * The **Page button**'s content script, on Mijn Advertenties only (ADR-0040).
 *
 * **Signed out, nothing is drawn** (ADR-0007): the display state is asked first,
 * and only an answer other than `signed-out` mounts anything. It is asked again
 * whenever the tab comes back into view or the window regains focus — signing
 * in from the popup opens a window and gives focus back when it closes — so the
 * buttons appear without a reload and go when the seller signs out.
 */
const worker = workerPort();
const page = new PageButtonsOnPage({
  doc: document,
  worker,
  findSlots,
  plansUrl: `${__SITE_URL__}/#abonnementen`,
  render: (overlay) => {
    const root: Root = createRoot(overlay);
    return { render: (element) => root.render(element), unmount: () => root.unmount() };
  },
  refresh: () => location.reload(),
});

let asking = false;
async function evaluate(): Promise<void> {
  if (asking) return;
  asking = true;
  try {
    const answer = await worker.displayState();
    if (answer.status === "signed-out") page.stop();
    else page.start(answer.status === "ready" && grantsNothing(answer.plan));
  } finally {
    asking = false;
  }
}

void evaluate();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void evaluate();
});
window.addEventListener("focus", () => void evaluate());
