import type { AdminTier } from "@mprelist/contracts";
import { describe, expect, it } from "vitest";

import { AdminApi, asAdminTiers, asCurrency, asUntaggedPrices } from "./admin-api";
import { DEFAULT_ADMIN_CONFIG } from "./admin-config";
import type { Http } from "./discovery";
import { json } from "./testing";

const PRO: AdminTier = {
  tier: { code: "pro", name: "Pro" },
  relistQuotaPerPeriod: 50,
  features: {},
  published: true,
  isDefault: false,
  prices: [{ stripePriceId: "price_pro", interval: "month" }],
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function api(answer: () => Response = () => json({ tiers: [PRO] })) {
  const calls: Call[] = [];
  const http: Http = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as string | undefined,
    });
    return answer();
  };
  return { client: new AdminApi(DEFAULT_ADMIN_CONFIG, () => "an-access-token", http), calls };
}

const empty = (status: number): Response => new Response(null, { status });

describe("reading the catalog", () => {
  it("asks the route behind the ADMIN guard, with the token this tab holds", async () => {
    const { client, calls } = api();

    await expect(client.tiers()).resolves.toEqual({ status: "ready", tiers: [PRO] });
    expect(calls[0]?.url).toBe("http://localhost:8080/api/admin/tiers");
    expect(calls[0]?.headers["authorization"]).toBe("Bearer an-access-token");
  });

  it("reads a 403 as the wrong person rather than as a fault", async () => {
    // Not a retry and not a re-sign-in: signing in again returns the same person.
    const { client } = api(() => empty(403));

    await expect(client.tiers()).resolves.toEqual({ status: "forbidden" });
  });

  it("and a 401 as a token that has run out, which one redirect fixes", async () => {
    // There is no refresh token by design — nothing survives the page.
    const { client } = api(() => empty(401));

    await expect(client.tiers()).resolves.toEqual({ status: "signed-out" });
  });

  it("and anything else as the API not answering", async () => {
    for (const status of [404, 409, 500, 503]) {
      const { client } = api(() => empty(status));

      await expect(client.tiers(), String(status)).resolves.toEqual({ status: "unavailable" });
    }
  });

  it("and a backend it could not reach as the same thing", async () => {
    const http: Http = async () => {
      throw new TypeError("Failed to fetch");
    };

    await expect(
      new AdminApi(DEFAULT_ADMIN_CONFIG, () => "t", http).tiers(),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("refuses the whole catalog when one row cannot be read", async () => {
    // A half-read catalog is worse than none: the rows that survived look complete,
    // and this is the screen somebody edits a quota on.
    const { client } = api(() => json({ tiers: [PRO, { ...PRO, relistQuotaPerPeriod: -1 }] }));

    await expect(client.tiers()).resolves.toEqual({ status: "unavailable" });
  });
});

describe("reading a tier off the wire", () => {
  it("takes the shape the contract describes", () => {
    expect(asAdminTiers({ tiers: [PRO] })).toEqual([PRO]);
  });

  it("keeps a null price, which is the free tier and every tier Stripe has not priced", () => {
    const free = { ...PRO, prices: [], published: false };

    expect(asAdminTiers({ tiers: [free] })).toEqual([free]);
  });

  it("refuses a row with a field missing or wrong, whichever one it is", () => {
    for (const broken of [
      { ...PRO, tier: undefined },
      { ...PRO, tier: { code: "" } },
      { ...PRO, relistQuotaPerPeriod: "50" },
      { ...PRO, relistQuotaPerPeriod: 1.5 },
      { ...PRO, features: null },
      { ...PRO, features: [] },
      { ...PRO, published: "yes" },
      { ...PRO, isDefault: undefined },
      { ...PRO, prices: [{ stripePriceId: 7, interval: "month" }] },
    ]) {
      expect(asAdminTiers({ tiers: [broken] }), JSON.stringify(broken)).toBeNull();
    }
  });

  it("refuses a body that is not the shape at all", () => {
    expect(asAdminTiers(null)).toBeNull();
    expect(asAdminTiers({})).toBeNull();
    expect(asAdminTiers([PRO])).toBeNull();
  });
});

describe("saving a tier", () => {
  const EDIT = {
    code: "pro",
    name: "Pro",
    relistQuotaPerPeriod: 75,
    features: {},
    published: true,
  };

  it("puts the whole editable half, and never the price", async () => {
    // The `PUT` is total over what may change, and what may not is the decision
    // (ADR-0019): the amount is Stripe's, and the tag on the Price is the only link.
    // `code` joined it in T76 (ADR-0031) and is stated like everything else — on
    // this row it is the one already stored, which is how an edit says it is not
    // moving it.
    const { client, calls } = api(() => json(PRO));

    await expect(client.save("pro", EDIT)).resolves.toEqual({ status: "saved", tier: PRO });
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toBe("http://localhost:8080/api/admin/tiers/pro");
    const sent = JSON.parse(calls[0]?.body ?? "{}") as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual([
      "code",
      "features",
      "name",
      "published",
      "relistQuotaPerPeriod",
    ]);
  });

  it("reads a 409 as a catalog that cannot hold the tier as described", async () => {
    // One status for four facts since ADR-0031 — no Price, no grant, a frozen code
    // or a taken one — because they are one recovery to the only caller.
    const { client } = api(() => empty(409));

    await expect(client.save("pro", EDIT)).resolves.toEqual({ status: "conflicted" });
  });

  it("and a 404 as a code the catalog no longer stores", async () => {
    const { client } = api(() => empty(404));

    await expect(client.save("nonesuch", EDIT)).resolves.toEqual({ status: "gone" });
  });

  it("and a 400 as an edit the API would not take", async () => {
    const { client } = api(() => empty(400));

    await expect(client.save("pro", EDIT)).resolves.toEqual({ status: "rejected" });
  });

  it("escapes a code that would otherwise change the path", async () => {
    const { client, calls } = api(() => json(PRO));

    await client.save("a code/with a slash", EDIT);

    expect(calls[0]?.url).toBe("http://localhost:8080/api/admin/tiers/a%20code%2Fwith%20a%20slash");
  });
});

describe("moving the default", () => {
  it("puts nothing at all, because there is nothing to say", async () => {
    // A move rather than a toggle: the API offers no way to unset it, so no
    // request this screen can send leaves the catalog without a default.
    const { client, calls } = api(() => json({ ...PRO, isDefault: true }));

    await expect(client.makeDefault("pro")).resolves.toEqual({
      status: "saved",
      tier: { ...PRO, isDefault: true },
    });
    expect(calls[0]?.url).toBe("http://localhost:8080/api/admin/tiers/pro/default");
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.body).toBeUndefined();
  });
});

describe("setting the order the plans are read in", () => {
  const FREE: AdminTier = {
    tier: { code: "free", name: "Free" },
    relistQuotaPerPeriod: 3,
    features: {},
    published: false,
    isDefault: true,
    prices: [],
  };

  it("puts the whole catalog, by code, in one request", async () => {
    // A sequence and never a per-row index (T75, #164; ADR-0030): moving a tier
    // moves others, so one drag is one write.
    const { client, calls } = api(() => json({ tiers: [PRO, FREE] }));

    await expect(client.order(["pro", "free"])).resolves.toEqual({
      status: "ordered",
      tiers: [PRO, FREE],
    });
    expect(calls[0]?.url).toBe("http://localhost:8080/api/admin/tiers/order");
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.body).toBe('{"codes":["pro","free"]}');
  });

  it("reads a 409 as a stale screen rather than as a tier the catalog cannot hold", async () => {
    // The same status the edit route answers, meaning something else entirely:
    // here the list was not the catalog's set, because a tier arrived or left
    // while the page was open. Folding the two together would put the edit form's
    // sentence about Stripe Prices on a failed drag.
    const { client } = api(() => empty(409));

    await expect(client.order(["pro"])).resolves.toEqual({ status: "stale" });
  });

  it("and a 401 as a token that has run out", async () => {
    const { client } = api(() => empty(401));

    await expect(client.order(["pro", "free"])).resolves.toEqual({ status: "signed-out" });
  });

  it("and refuses a body it cannot read rather than rendering half a catalog", async () => {
    // All of them or none of them, like every other read of this list: the rows
    // that survived would look complete on the screen somebody arranges a catalog
    // on.
    const { client } = api(() => json({ tiers: [{ tier: { code: "pro" } }] }));

    await expect(client.order(["pro"])).resolves.toEqual({ status: "unavailable" });
  });
});

describe("the Prices nobody tagged", () => {
  it("reads them, one-offs and all", async () => {
    const untagged = { id: "price_1", nickname: null, amount: 999, currency: "eur", interval: null };
    const { client, calls } = api(() => json({ prices: [untagged] }));

    await expect(client.unadoptedPrices()).resolves.toEqual({ status: "ready", prices: [untagged] });
    expect(calls[0]?.url).toBe("http://localhost:8080/api/admin/prices");
  });

  it("reads an empty list as the good state rather than as a failure", async () => {
    // Every Price in Stripe is tagged, which is what the list exists to make
    // checkable. A `503` is the different thing and is not this.
    const { client } = api(() => json({ prices: [] }));

    await expect(client.unadoptedPrices()).resolves.toEqual({ status: "ready", prices: [] });
  });

  it("and a Stripe that could not be asked as unknown rather than empty", async () => {
    const { client } = api(() => empty(503));

    await expect(client.unadoptedPrices()).resolves.toEqual({ status: "unavailable" });
  });

  it("refuses a price that cannot be read", () => {
    expect(asUntaggedPrices({ prices: [{ id: "price_1", currency: "eur" }] })).toBeNull();
    expect(asUntaggedPrices({ prices: [{ id: "", nickname: null, amount: 1, currency: "eur", interval: null }] }))
      .toBeNull();
    expect(asUntaggedPrices(null)).toBeNull();
  });
});

describe("creating a plan", () => {
  /** Sold both ways, which is what one submit creates since T66. */
  const PLAN = {
    tierCode: "starter",
    name: "Starter",
    prices: [
      { amount: 500, interval: "month" },
      { amount: 5000, interval: "year" },
    ],
    relistQuotaPerPeriod: 10,
    features: {},
    published: false,
  };

  it("posts the whole plan, and answers with the tier the sync made", async () => {
    const { client, calls } = api(() => json(PRO, 201));

    await expect(client.createPlan(PLAN)).resolves.toEqual({ status: "created", tier: PRO });
    expect(calls[0]?.url).toBe("http://localhost:8080/api/admin/plans");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual(PLAN);
  });

  it("reads a 409 as a code already taken, which is what makes create mean create", async () => {
    // Adopting it instead would repoint an existing tier's Price — right for a
    // webhook, and quite wrong for a button labelled New plan.
    const { client } = api(() => empty(409));

    await expect(client.createPlan(PLAN)).resolves.toEqual({ status: "exists" });
  });

  it("and passes on Stripe's own words when Stripe refuses", async () => {
    // The one answer in this API with a body worth reading: no status could say
    // "at least 50 cents", and it is the only thing that says what to change.
    const { client } = api(() => json({ problem: "Amount must be at least 50 cents" }, 422));

    await expect(client.createPlan(PLAN)).resolves.toEqual({
      status: "refused",
      problem: "Amount must be at least 50 cents",
    });
  });

  it("and says something rather than nothing when that body is missing", async () => {
    const { client } = api(() => new Response(null, { status: 422 }));

    await expect(client.createPlan(PLAN)).resolves.toEqual({
      status: "refused",
      problem: "Stripe refused the plan.",
    });
  });

  it("and reads 401 and 403 the way every other call here does", async () => {
    await expect(api(() => empty(401)).client.createPlan(PLAN)).resolves.toEqual({ status: "signed-out" });
    await expect(api(() => empty(403)).client.createPlan(PLAN)).resolves.toEqual({ status: "forbidden" });
  });
});

describe("what the catalog is priced in", () => {
  it("is the one currency this Stripe account settles in", async () => {
    // One for every tier (T63, #129): a plan screen is a comparison, and €9,99
    // against $12.99 is not one a buyer can make without knowing today's rate.
    const { client, calls } = api(() => json({ currency: "eur" }));

    await expect(client.currency()).resolves.toEqual({ status: "ready", currency: "eur" });
    expect(calls[0]?.url).toBe("http://localhost:8080/api/admin/currency");
  });

  it("and is unknown rather than guessed when Stripe could not be asked", async () => {
    // The form then creates nothing: the guess is a Price the account cannot settle
    // in, which Stripe refuses at the worst moment.
    const { client } = api(() => empty(503));

    await expect(client.currency()).resolves.toEqual({ status: "unavailable" });
  });

  it("refuses an answer that cannot be read", () => {
    expect(asCurrency({ currency: "" })).toBeNull();
    expect(asCurrency({})).toBeNull();
    expect(asCurrency({ currency: 7 })).toBeNull();
    expect(asCurrency(null)).toBeNull();
  });
});
