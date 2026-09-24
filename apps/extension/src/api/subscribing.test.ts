import type { Plan } from "@mprelist/contracts";
import { describe, expect, it } from "vitest";

import type { AccessToken } from "../auth/session";
import { Subscribing, asPaymentMethods, asPlans } from "./subscribing";

const PRO: Plan = {
  tier: { code: "pro", name: "Pro" },
  relistQuotaPerPeriod: 50,
  features: {},
  prices: [{ amount: 999, currency: "eur", interval: "month" }],
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function api(options: { token?: AccessToken; answer?: () => Response | Promise<Response> } = {}) {
  const calls: Call[] = [];
  const client = new Subscribing({
    tokens: { accessToken: async () => options.token ?? { status: "ready", token: "an-access-token" } },
    http: async (url, init) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body as string | undefined,
      });
      return (options.answer ?? (() => json({ plans: [PRO] })))();
    },
  });
  return { client, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const empty = (status: number): Response => new Response(null, { status });

describe("asking what can be bought", () => {
  it("sends the token to the route the contract names", async () => {
    const { client, calls } = api();

    await expect(client.plans()).resolves.toEqual({
      status: "ready",
      plans: [PRO],
      paymentMethods: [],
    });
    expect(calls[0]?.url).toBe("http://localhost:8080/api/plans");
    expect(calls[0]?.headers["authorization"]).toBe("Bearer an-access-token");
    expect(calls[0]?.headers["X-Mprelist-Client"]).toBe("extension/9.9.9");
  });

  it("reads an empty list as an answer rather than as a failure", async () => {
    // Nothing is on sale, which is true of every stack whose Stripe Prices have
    // not been created yet (T22, #28). Calling it "unavailable" would report a
    // fault that is not there.
    const { client } = api({ answer: () => json({ plans: [] }) });

    await expect(client.plans()).resolves.toEqual({ status: "ready", plans: [], paymentMethods: [] });
  });

  it("reads a Stripe that could not be asked as unavailable", async () => {
    // `503` with an empty body, which the cards render as "prices unavailable,
    // retry" — never a guessed amount and never a free plan.
    const { client } = api({ answer: () => empty(503) });

    await expect(client.plans()).resolves.toEqual({ status: "unavailable" });
  });

  it("and a build the backend has stopped serving as outdated, not unavailable", async () => {
    // T43 (#52): the one refusal a retry cannot fix and the user can.
    const { client } = api({ answer: () => empty(426) });

    await expect(client.plans()).resolves.toEqual({ status: "outdated" });
  });

  it("and a refused token as signed out", async () => {
    const { client } = api({ answer: () => empty(401) });

    await expect(client.plans()).resolves.toEqual({ status: "signed-out" });
  });

  it("asks nothing at all when there is no session", async () => {
    const { client, calls } = api({ token: { status: "signed-out" } });

    await expect(client.plans()).resolves.toEqual({ status: "signed-out" });
    expect(calls).toHaveLength(0);
  });

  it("reads a backend it could not reach as unavailable", async () => {
    const { client } = api({
      answer: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await expect(client.plans()).resolves.toEqual({ status: "unavailable" });
  });

  it("refuses the whole list when one card cannot be read", async () => {
    // All of them or none of them, which is the route's own rule for a price it
    // could not fetch: a plan screen is a comparison, and the card that survived a
    // half-read list would look complete.
    const { client } = api({
      answer: () => json({ plans: [PRO, { ...PRO, tier: { code: "power" } }] }),
    });

    await expect(client.plans()).resolves.toEqual({ status: "unavailable" });
  });
});

describe("reading the plans off the wire", () => {
  it("takes the shape the contract describes", () => {
    expect(asPlans({ plans: [PRO] })).toEqual([PRO]);
  });

  // A published tier granting nothing is unwriteable (ADR-0029), so `null` on a
  // card is the only other thing the number can be: unlimited.
  it("reads a card with no cap as the null it is", () => {
    const unlimited = { ...PRO, relistQuotaPerPeriod: null };

    expect(asPlans({ plans: [unlimited] })).toEqual([unlimited]);
  });

  it("refuses a card with a field missing, whichever one it is", () => {
    for (const broken of [
      { ...PRO, tier: undefined },
      { ...PRO, tier: { code: "pro" } },
      { ...PRO, tier: { code: "", name: "Pro" } },
      { ...PRO, relistQuotaPerPeriod: undefined },
      { ...PRO, relistQuotaPerPeriod: -1 },
      { ...PRO, relistQuotaPerPeriod: 1.5 },
      { ...PRO, features: undefined },
      { ...PRO, features: [] },
      { ...PRO, prices: undefined },
      // Never empty: a tier with nothing to charge against cannot be published, so
      // a card with no price is a card whose only button could not open a Checkout.
      { ...PRO, prices: [] },
      { ...PRO, prices: [{ amount: 999, currency: "eur" }] },
      { ...PRO, prices: [{ amount: "999", currency: "eur", interval: "month" }] },
      { ...PRO, prices: [{ amount: 9.99, currency: "eur", interval: "month" }] },
      { ...PRO, prices: [{ amount: 999, currency: "", interval: "month" }] },
      // All of them or none of them, like the list itself: a rhythm that cannot be
      // read would be a button whose amount is a guess.
      { ...PRO, prices: [{ amount: 999, currency: "eur", interval: "month" }, { amount: 1 }] },
    ]) {
      expect(asPlans({ plans: [broken] }), JSON.stringify(broken)).toBeNull();
    }
  });

  it("allows an amount of zero, which is a Price Stripe can hold", () => {
    // Refusing it would blank the whole screen over a plan somebody deliberately
    // made free — and the list is all-or-nothing, so it really is the whole screen.
    const free = { ...PRO, prices: [{ amount: 0, currency: "eur", interval: "month" }] };

    expect(asPlans({ plans: [free] })).toEqual([free]);
  });

  it("refuses a body that is not the shape at all", () => {
    expect(asPlans(null)).toBeNull();
    expect(asPlans({})).toBeNull();
    expect(asPlans({ plans: {} })).toBeNull();
    expect(asPlans([PRO])).toBeNull();
  });
});

describe("reading the ways to pay off the wire", () => {
  it("is Stripe's own spelling, passed through unedited", () => {
    // What each is *called* is `waysToPay`'s in @mprelist/contracts. Translating here
    // would put the vocabulary in two places, one layer apart.
    expect(asPaymentMethods({ paymentMethods: ["ideal", "paypal"] })).toEqual(["ideal", "paypal"]);
  });

  it("is empty rather than null when there is nothing to read", () => {
    // Empty already means the one thing a client would do with absent — say
    // nothing — so there is no second state to branch on (T65, #137).
    expect(asPaymentMethods({})).toEqual([]);
    expect(asPaymentMethods(null)).toEqual([]);
    expect(asPaymentMethods({ paymentMethods: "ideal" })).toEqual([]);
    expect(asPaymentMethods({ paymentMethods: {} })).toEqual([]);
  });

  it("drops an entry that is not a method rather than failing the lot", () => {
    // The opposite of `asPlans` above, deliberately: one odd entry says nothing
    // about the rest, and there is no comparison here to be made wrong by a gap.
    expect(asPaymentMethods({ paymentMethods: ["ideal", 7, null, "", "card"] })).toEqual([
      "ideal",
      "card",
    ]);
  });

  it("never costs the cards, however wrong it is", () => {
    // The whole reason it is read separately: the plan screen is a comparison and
    // this is a line under its title, so a malformed list loses the sentence and
    // leaves every plan, rhythm and amount exactly where it was.
    expect(asPlans({ plans: [PRO], paymentMethods: "nonsense" })).toEqual([PRO]);
    expect(asPaymentMethods({ plans: [PRO], paymentMethods: "nonsense" })).toEqual([]);
  });
});

describe("buying a plan", () => {
  it("posts the tier code and the rhythm, never a price id", async () => {
    // The code is the stable handle (ADR-0014) and resolving it is the backend's,
    // which is what stops a client naming a Price nobody published. The rhythm is
    // as required since T62 (#128): a tier may be sold monthly and annually, so
    // the code alone names two prices.
    const { client, calls } = api({ answer: () => json({ url: "https://checkout.stripe.com/c/pay/1" }) });

    await expect(client.checkout("pro", "month")).resolves.toEqual({
      status: "opened",
      url: "https://checkout.stripe.com/c/pay/1",
    });
    expect(calls[0]?.url).toBe("http://localhost:8080/api/checkout");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBe('{"tierCode":"pro","interval":"month"}');
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
  });

  it("reads a plan that is no longer on sale as gone, not as unavailable", async () => {
    // The two must not collapse: one says the plan is gone and one says come back
    // in a minute, and a client showing "no longer on sale" for a network blip
    // would be lying to a buyer.
    const { client } = api({ answer: () => empty(404) });

    await expect(client.checkout("pro", "month")).resolves.toEqual({ status: "gone" });
  });

  it("and a Stripe that could not be asked as unavailable", async () => {
    const { client } = api({ answer: () => empty(503) });

    await expect(client.checkout("pro", "month")).resolves.toEqual({ status: "unavailable" });
  });

  it("reads somebody Stripe is already billing as already paying (T83)", async () => {
    // A denial — the only answer this route gives that is about the caller — and
    // the screen that asked already holds what to do about it: Betaling beheren.
    const { client } = api({ answer: () => json({ reason: "ALREADY_PAYING" }, 409) });

    await expect(client.checkout("pro", "month")).resolves.toEqual({ status: "already-paying" });
  });

  it("and a 409 that says nothing it recognises as unavailable", async () => {
    // Read by the code and never the status, like every denial: a conflict this
    // build cannot name is not a reason to tell somebody they already pay.
    const { client } = api({ answer: () => empty(409) });

    await expect(client.checkout("pro", "month")).resolves.toEqual({ status: "unavailable" });
  });

  it("refuses an answer with no URL in it rather than opening nothing", async () => {
    const { client } = api({ answer: () => json({ url: "" }) });

    await expect(client.checkout("pro", "month")).resolves.toEqual({ status: "unavailable" });
  });
});

describe("managing what has already been bought", () => {
  it("posts nothing at all, because there is nothing to say", async () => {
    // Who is asking comes from the token, and what the Portal offers is configured
    // in Stripe's dashboard. A `content-type: application/json` with no body after
    // it is a request the backend is entitled to refuse.
    const { client, calls } = api({ answer: () => json({ url: "https://billing.stripe.com/p/session/1" }) });

    await expect(client.portal()).resolves.toEqual({
      status: "opened",
      url: "https://billing.stripe.com/p/session/1",
    });
    expect(calls[0]?.url).toBe("http://localhost:8080/api/portal");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBeUndefined();
    expect(calls[0]?.headers["content-type"]).toBeUndefined();
  });

  it("reads an account Stripe has never billed as gone", async () => {
    // Every free user who has not bought anything, which is most of them — and not
    // a fault on either side.
    const { client } = api({ answer: () => empty(404) });

    await expect(client.portal()).resolves.toEqual({ status: "gone" });
  });

  it("and still names the build making the call", async () => {
    const { client, calls } = api({ answer: () => json({ url: "https://billing.stripe.com/p/1" }) });

    await client.portal();

    expect(calls[0]?.headers["X-Mprelist-Client"]).toBe("extension/9.9.9");
  });
});
