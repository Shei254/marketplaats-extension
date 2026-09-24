import type { Plans } from "@mprelist/contracts";
import { describe, expect, it } from "vitest";

import { plansOnOffer, type Fetch } from "./plans-on-offer";

const PLANS: Plans = {
  plans: [
    {
      tier: { code: "pro", name: "Pro" },
      relistQuotaPerPeriod: 50,
      features: {},
      prices: [{ amount: 999, currency: "eur", interval: "month" }],
    },
  ],
  paymentMethods: ["ideal", "card"],
};

/** A `fetch` that records what it was asked and answers one fixed response. */
function answering(respond: () => Promise<Response>): { fetch: Fetch; asked: [string, RequestInit?][] } {
  const asked: [string, RequestInit?][] = [];
  return {
    asked,
    fetch: (url, init) => {
      asked.push([url, init]);
      return respond();
    },
  };
}

describe("asking what is on sale (T58)", () => {
  it("is the API's plans, from the address the deployment serves", async () => {
    const api = answering(async () => Response.json(PLANS));

    const answer = await plansOnOffer("https://api.example.test", api.fetch);

    expect(answer).toEqual({ status: "ready", ...PLANS });
    expect(api.asked[0]?.[0]).toBe("https://api.example.test/api/plans");
  });

  it("carries nothing that says who is asking", async () => {
    // ADR-0017's line for the public pages: no cookie, no token. What the API
    // answers a visitor is the same thing it answers the popup, so there is
    // nothing to identify anybody for.
    const api = answering(async () => Response.json(PLANS));

    await plansOnOffer("https://api.example.test", api.fetch);

    const init = api.asked[0]?.[1];
    expect(init?.credentials).toBe("omit");
    expect(init?.headers).toBeUndefined();
  });

  it("is unavailable when Stripe could not be asked", async () => {
    // The API's 503: never a free plan or a guessed amount, and never an empty
    // list, which means something else.
    const api = answering(async () => new Response(null, { status: 503 }));

    expect(await plansOnOffer("https://api.example.test", api.fetch)).toEqual({ status: "unavailable" });
  });

  it("and when the API cannot be reached at all", async () => {
    const api = answering(() => Promise.reject(new TypeError("Failed to fetch")));

    expect(await plansOnOffer("https://api.example.test", api.fetch)).toEqual({ status: "unavailable" });
  });

  it("and when what came back is not the answer it asked for", async () => {
    // A proxy's HTML error page is a 200 as often as not.
    const api = answering(async () => new Response("<html>Bad Gateway</html>", { status: 200 }));

    expect(await plansOnOffer("https://api.example.test", api.fetch)).toEqual({ status: "unavailable" });
  });

  it("reads an empty list as an answer, not as a fault", async () => {
    const api = answering(async () => Response.json({ plans: [], paymentMethods: [] }));

    expect(await plansOnOffer("https://api.example.test", api.fetch)).toEqual({
      status: "ready",
      plans: [],
      paymentMethods: [],
    });
  });
});
