import { describe, expect, it, vi } from "vitest";

import type { AccessToken } from "../auth/session";
import { RelistAuthorizations, asRemainingQuota } from "./relist-authorizations";

const GRANT = {
  authToken: "a.signed.jwt",
  expiresAt: "2026-08-20T10:00:45.000Z",
  jti: "8b1f0e2a-0c3d-4e5f-9a7b-1c2d3e4f5a6b",
};

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function client(options: { token?: AccessToken; answer?: () => Response | Promise<Response> } = {}) {
  const calls: Call[] = [];
  const api = new RelistAuthorizations({
    tokens: { accessToken: async () => options.token ?? { status: "ready", token: "an-access-token" } },
    http: async (url, init) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: JSON.parse(typeof init?.body === "string" ? init.body : "null"),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return (options.answer ?? (() => json(GRANT)))();
    },
  });
  return { api, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("asking for permission", () => {
  it("names the ad, as the caller the token says", async () => {
    const { api, calls } = client();

    await expect(api.authorize("m2196000")).resolves.toEqual({ decision: "proceed", grant: GRANT });
    expect(calls[0]?.url).toBe("http://localhost:8080/api/relist/authorize");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({ adId: "m2196000" });
    expect(calls[0]?.headers["authorization"]).toBe("Bearer an-access-token");
  });

  it("names the build asking, on the route that spends a unit as much as on the one that reads", async () => {
    // Both call sites carry it or the lever is half a lever (T43, #52): a backend
    // that refused an old build's `/api/me` and served its `authorize` would have
    // stopped the screen and not the deletes.
    const { api, calls } = client();

    await api.authorize("m2196000");

    expect(calls[0]?.headers["X-Mprelist-Client"]).toBe("extension/9.9.9");
  });

  it("hands the answer to the gate rather than reading it here", async () => {
    // One place decides what a denial means, and it is the pure function with a
    // suite of its own (#34). This file's job ends at the response.
    const { api } = client({
      answer: () => json({ reason: "QUOTA_EXCEEDED", resetAt: "2026-09-14T08:31:22.101Z" }, 429),
    });

    await expect(api.authorize("m1")).resolves.toEqual({
      decision: "refuse",
      locked: { state: "upgrade", resetAt: "2026-09-14T08:31:22.101Z" },
    });
  });

  it("refuses without asking when there is no token to ask with", async () => {
    // Not a denial with a reason code, and certainly not permission. The popup's
    // own next refresh is what will tell the user they are signed out.
    const { api, calls } = client({ token: { status: "signed-out" } });

    await expect(api.authorize("m1")).resolves.toEqual({
      decision: "refuse",
      locked: { state: "retry" },
    });
    expect(calls).toHaveLength(0);
  });

  it("refuses when the backend cannot be reached at all", async () => {
    const { api } = client({
      answer: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await expect(api.authorize("m1")).resolves.toEqual({
      decision: "refuse",
      locked: { state: "retry" },
    });
  });

  it("reads the body of a refusal, which is where the reason is", async () => {
    // A `4xx` that is not JSON is still an answer — it just carries no reason, and
    // the gate turns that into "try again" rather than a guess.
    const { api } = client({ answer: () => new Response("<html>bad gateway</html>", { status: 502 }) });

    await expect(api.authorize("m1")).resolves.toEqual({
      decision: "refuse",
      locked: { state: "retry" },
    });
  });
});

describe("saying what happened", () => {
  it("names the reservation and the outcome, and answers with what is left", async () => {
    // The quota comes back from the call that spent it, so a popup that has just
    // relisted needs no second `/api/me` (T32, #41).
    const { api, calls } = client({
      answer: () => json({ quotaRemaining: 2, resetAt: "2026-09-14T08:31:22.101Z" }),
    });

    await expect(api.report(GRANT.jti, "SUCCESS")).resolves.toEqual({
      quotaRemaining: 2,
      resetAt: "2026-09-14T08:31:22.101Z",
    });
    expect(calls[0]?.url).toBe("http://localhost:8080/api/relist/complete");
    expect(calls[0]?.body).toEqual({ jti: GRANT.jti, outcome: "SUCCESS" });
  });

  it("answers with nothing when the body is not a quota, rather than a number it made up", () => {
    // A half-read body on the screen is a count the gate does not agree with,
    // which is the failure `RemainingQuota` exists to make unreachable.
    expect(asRemainingQuota({ quotaRemaining: 2 })).toBeNull();
    expect(asRemainingQuota({ quotaRemaining: -1, resetAt: "…" })).toBeNull();
    expect(asRemainingQuota({ quotaRemaining: "2", resetAt: "…" })).toBeNull();
    expect(asRemainingQuota(null)).toBeNull();
  });

  it("but an explicit null quota is a tier with no cap rather than a body it could not read", () => {
    // T73 (ADR-0029): there is nothing left of a grant with no ceiling, and the
    // strip draws "Unlimited reposts" from exactly this.
    expect(asRemainingQuota({ quotaRemaining: null, resetAt: "2026-09-14T08:31:22.101Z" })).toEqual({
      quotaRemaining: null,
      resetAt: "2026-09-14T08:31:22.101Z",
    });
  });

  it("gives up quietly when the backend is unreachable", async () => {
    // The relist already happened. A reservation nobody reports on is refunded by
    // reconciliation after a grace window (#24), and a late report still wins —
    // which is what makes giving up safe rather than merely convenient.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { api } = client({
      answer: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await expect(api.report(GRANT.jti, "FAILED_AFTER_DELETE")).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("and when it answers with a refusal of its own", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { api } = client({ answer: () => json(null, 404) });

    await expect(api.report(GRANT.jti, "SUCCESS")).resolves.toBeNull();
    warn.mockRestore();
  });

  it("and when there is no token left to report with", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { api, calls } = client({ token: { status: "unavailable" } });

    await expect(api.report(GRANT.jti, "SUCCESS")).resolves.toBeNull();
    expect(calls).toHaveLength(0);
    warn.mockRestore();
  });
});
