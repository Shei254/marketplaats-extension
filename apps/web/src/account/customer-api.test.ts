import { describe, expect, it } from "vitest";

import { CustomerApi, type Fetch } from "./customer-api";

/** The landing page's calls as its visitor (T85): what each sends, and how each answer is read. */

function api(answer: (url: string, init?: RequestInit) => Response) {
  const sent: { url: string; init?: RequestInit }[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, init });
    return answer(url, init);
  };
  return { client: new CustomerApi("https://api.example.test", "a-token", fetch), sent };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const empty = (status: number) => new Response(null, { status });

describe("every call", () => {
  it("carries the token and nothing else about who is asking", async () => {
    const { client, sent } = api(() => json({ tier: { code: "free" }, paying: false, rhythm: null }));

    await client.me();

    expect(sent[0]?.url).toBe("https://api.example.test/api/me");
    expect(sent[0]?.init?.credentials).toBe("omit");
    expect((sent[0]?.init?.headers as Record<string, string>)["authorization"]).toBe("Bearer a-token");
  });

  it("reads a lapsed token as its own answer, so the page signs in again", async () => {
    const { client } = api(() => empty(401));

    expect(await client.me()).toEqual({ status: "expired" });
    expect(await client.switchPlan({ tierCode: "pro", interval: "month" })).toEqual({ status: "expired" });
  });
});

describe("who they are", () => {
  it("is their tier, whether Stripe is billing them, and at which rhythm", async () => {
    const { client } = api(() => json({ tier: { code: "pro", name: "Pro" }, paying: true, rhythm: "year" }));

    expect(await client.me()).toEqual({
      status: "ready",
      tierCode: "pro",
      tierName: "Pro",
      grant: null,
      paying: true,
      rhythm: "year",
      inDunning: false,
      pendingSwitch: null,
    });
  });

  it("reads Dunning and a pending switch off the same body (T90)", async () => {
    const pending = { tier: { code: "max", name: "Max" }, rhythm: "month", at: "2026-12-12T09:00:00Z" };
    const { client } = api(() =>
      json({
        subscriptionStatus: "PAST_DUE",
        tier: { code: "pro", name: "Pro" },
        relistQuotaPerPeriod: 50,
        paying: true,
        rhythm: "month",
        pendingSwitch: pending,
      }),
    );

    expect(await client.me()).toMatchObject({ inDunning: true, grant: 50, pendingSwitch: pending });
  });

  it("and no tier at all is the 403 the API answers it with", async () => {
    const { client } = api(() => json({ reason: "NO_TIER" }, 403));

    expect(await client.me()).toEqual({ status: "no-tier" });
  });
});

describe("a Plan switch", () => {
  it("is priced by Stripe, sent the plan and rhythm as a body", async () => {
    const { client, sent } = api(() => json({ amount: 1500, currency: "eur", renewsAt: "2026-12-12T09:00:00Z" }));

    expect(await client.previewSwitch({ tierCode: "pro", interval: "month" })).toEqual({
      status: "ready",
      amount: 1500,
      currency: "eur",
      renewsAt: "2026-12-12T09:00:00Z",
    });
    expect(sent[0]?.url).toBe("https://api.example.test/api/plan-switch/preview");
    expect(JSON.parse(String(sent[0]?.init?.body))).toEqual({ tierCode: "pro", interval: "month" });
  });

  it("is done, or waits on the payer at the page Stripe names", async () => {
    const done = api(() => json({ confirmAt: null }));
    const waiting = api(() => json({ confirmAt: "https://invoice.stripe.com/i/x" }));

    expect(await done.client.switchPlan({ tierCode: "pro", interval: "month" })).toEqual({ status: "switched" });
    expect(await waiting.client.switchPlan({ tierCode: "pro", interval: "month" })).toEqual({
      status: "confirm",
      url: "https://invoice.stripe.com/i/x",
    });
  });

  it("reads 409 as nobody to switch, 404 as not for sale and anything else as unavailable", async () => {
    const choice = { tierCode: "pro", interval: "month" };

    expect(await api(() => json({ reason: "NOT_PAYING" }, 409)).client.switchPlan(choice)).toEqual({
      status: "not-paying",
    });
    expect(await api(() => empty(404)).client.previewSwitch(choice)).toEqual({ status: "not-for-sale" });
    expect(await api(() => empty(503)).client.previewSwitch(choice)).toEqual({ status: "unavailable" });
  });

  it("reads OPEN_INVOICE as Dunning, by the code (T90)", async () => {
    const choice = { tierCode: "pro", interval: "month" };

    expect(await api(() => json({ reason: "OPEN_INVOICE" }, 409)).client.switchPlan(choice)).toEqual({
      status: "invoice-open",
    });
    expect(await api(() => json({ reason: "OPEN_INVOICE" }, 409)).client.scheduleSwitch(choice)).toEqual({
      status: "invoice-open",
    });
  });

  it("schedules one for the renewal, and undoes it (T90)", async () => {
    const scheduled = api(() => json({ at: "2026-12-12T09:00:00Z" }));
    const undone = api(() => empty(204));

    expect(await scheduled.client.scheduleSwitch({ tierCode: "max", interval: "month" })).toEqual({
      status: "scheduled",
    });
    expect(scheduled.sent[0]?.url).toBe("https://api.example.test/api/plan-switch/scheduled");
    expect(scheduled.sent[0]?.init?.method).toBe("POST");
    expect(await undone.client.undoSwitch()).toEqual({ status: "undone" });
    expect(undone.sent[0]?.init?.method).toBe("DELETE");
  });
});

describe("Checkout and the Portal", () => {
  it("are a URL to send the browser to", async () => {
    const { client } = api(() => json({ url: "https://checkout.stripe.com/c/pay/x" }));

    expect(await client.checkout({ tierCode: "pro", interval: "year" })).toEqual({
      status: "opened",
      url: "https://checkout.stripe.com/c/pay/x",
    });
  });

  it("or a refusal, which is the page's to say", async () => {
    expect(await api(() => json({ reason: "ALREADY_PAYING" }, 409)).client.checkout({ tierCode: "pro", interval: "month" }))
      .toEqual({ status: "refused" });
    expect(await api(() => empty(404)).client.portal()).toEqual({ status: "refused" });
  });
});
