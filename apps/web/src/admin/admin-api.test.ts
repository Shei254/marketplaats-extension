import type { AdminTier } from "@mprelist/contracts";
import { describe, expect, it } from "vitest";

import { AdminApi, asAdminTiers, asUntaggedPrices } from "./admin-api";
import { DEFAULT_ADMIN_CONFIG } from "./admin-config";
import type { Http } from "./discovery";
import { json } from "./testing";

const PRO: AdminTier = {
  tier: { code: "pro", name: "Pro" },
  relistQuotaPerPeriod: 50,
  features: {},
  published: true,
  isDefault: false,
  stripePriceId: "price_pro",
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
    const free = { ...PRO, stripePriceId: null, published: false };

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
      { ...PRO, stripePriceId: 7 },
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
  const EDIT = { name: "Pro", relistQuotaPerPeriod: 75, features: {}, published: true };

  it("puts the whole editable half, and never the code or the price", async () => {
    // The `PUT` is total over what may change, and what may not is the decision
    // (ADR-0019): the amount is Stripe's, and the tag on the Price is the only link.
    const { client, calls } = api(() => json(PRO));

    await expect(client.save("pro", EDIT)).resolves.toEqual({ status: "saved", tier: PRO });
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toBe("http://localhost:8080/api/admin/tiers/pro");
    const sent = JSON.parse(calls[0]?.body ?? "{}") as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual([
      "features",
      "name",
      "published",
      "relistQuotaPerPeriod",
    ]);
  });

  it("reads a 409 as a tier with nothing to charge against", async () => {
    // The one way this route conflicts, and the way out is Stripe's.
    const { client } = api(() => empty(409));

    await expect(client.save("pro", EDIT)).resolves.toEqual({ status: "unsellable" });
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
