import { describe, expect, it } from "vitest";

import type { HandoffAnswer } from "../api/subscribing";
import { openStripePage } from "./stripe-tab";

function opener() {
  const opened: string[] = [];
  return { opened, open: async (url: string) => void opened.push(url) };
}

const answering = (answer: HandoffAnswer): Promise<HandoffAnswer> => Promise.resolve(answer);

describe("handing a browser over to Stripe", () => {
  it("opens a tab on the URL the backend gave us", async () => {
    const tabs = opener();

    const answer = await openStripePage(
      answering({ status: "opened", url: "https://checkout.stripe.com/c/pay/cs_1" }),
      tabs.open,
    );

    expect(tabs.opened).toEqual(["https://checkout.stripe.com/c/pay/cs_1"]);
    // And still says what happened, for the caller that is still there to hear it.
    expect(answer).toEqual({ status: "opened", url: "https://checkout.stripe.com/c/pay/cs_1" });
  });

  it("opens nothing when there was nothing to open", async () => {
    // A `gone` and an `unavailable` carry no URL at all, so a version of this that
    // reached for one would put `undefined` in the address bar of a tab that
    // opened in front of somebody who had just clicked Upgrade.
    for (const refusal of [
      { status: "gone" },
      { status: "unavailable" },
      { status: "signed-out" },
      { status: "outdated" },
    ] as const) {
      const tabs = opener();

      await expect(openStripePage(answering(refusal), tabs.open)).resolves.toEqual(refusal);
      expect(tabs.opened, refusal.status).toEqual([]);
    }
  });
});
