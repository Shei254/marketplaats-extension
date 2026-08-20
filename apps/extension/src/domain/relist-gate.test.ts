import { describe, expect, it } from "vitest";

import { RelistOrchestrator } from "./relist-orchestrator";
import {
  FakeMarktplaatsClient,
  FakeRelistPermission,
  InMemorySnapshotStore,
  refusing,
  sampleAd,
  type FakeEvent,
} from "./testing/fakes";

/**
 * The gate around the delete-first flow (T26, #35): what runs only on `proceed`,
 * and what the backend is told afterwards.
 *
 * The flow itself is `relist-orchestrator.test.ts` and is unchanged by this
 * ticket. What is asserted here is the pair of calls around it — and, mostly,
 * what does **not** happen when the first of them says no.
 */
function relisting(options: { gate?: FakeRelistPermission; createFailures?: number } = {}) {
  const events: FakeEvent[] = [];
  const client = new FakeMarktplaatsClient(events, {
    ads: { "ad-1": sampleAd() },
    createFailures: options.createFailures ?? 0,
  });
  const store = new InMemorySnapshotStore(events);
  const gate = options.gate ?? new FakeRelistPermission();
  return { orchestrator: new RelistOrchestrator(client, store, gate), client, store, gate, events };
}

/** What the fake gate answers `/complete` with — see `FakeRelistPermission`. */
const REPORTED_QUOTA = { quotaRemaining: 2, resetAt: "2026-09-14T08:31:22.101Z" };

describe("nothing runs without permission", () => {
  it("refuses before the ad is even captured", async () => {
    // Not just before the delete: the capture is what the backend's pacing rails
    // count as an attempt, and it fetches every photo of the ad.
    const { orchestrator, events, gate } = relisting({ gate: refusing() });

    const outcome = await orchestrator.relist("ad-1");

    expect(outcome).toEqual({ status: "refused", locked: { state: "upgrade", resetAt: null } });
    expect(events).toEqual([]);
    expect(gate.reports).toEqual([]);
  });

  it("carries the state the row will show back with it", async () => {
    const { orchestrator } = relisting({ gate: refusing({ state: "cooldown", retryAfter: 24 }) });

    expect(await orchestrator.relist("ad-1")).toEqual({
      status: "refused",
      locked: { state: "cooldown", retryAfter: 24 },
    });
  });

  it("leaves the ad exactly where it was", async () => {
    const { orchestrator, client, store } = relisting({ gate: refusing() });

    await orchestrator.relist("ad-1");

    expect(client.has("ad-1")).toBe(true);
    expect(await store.get("ad-1")).toBeNull();
  });
});

describe("what the backend is told", () => {
  it("settles the unit when the ad was relisted", async () => {
    const { orchestrator, gate } = relisting();

    await orchestrator.relist("ad-1");

    expect(gate.authorized).toEqual(["ad-1"]);
    expect(gate.reports).toEqual([{ jti: "grant-1", outcome: "SUCCESS" }]);
  });

  it("hands the unit back when nothing was deleted", async () => {
    // Nothing happened on Marktplaats, so nothing was consumed — this is the
    // refund the contract describes, and it is also the breakage canary: a spike
    // in these is how we find out Marktplaats moved something.
    const { orchestrator, gate } = relisting();

    const outcome = await orchestrator.relist("no-such-ad");

    expect(outcome.status).toBe("failed-before-delete");
    expect(gate.reports).toEqual([{ jti: "grant-1", outcome: "FAILED_BEFORE_DELETE" }]);
  });

  it("keeps the unit spent when the ad was deleted and could not be re-created", async () => {
    // The destructive half happened. Refunding here would give back a unit for a
    // relist that cost the user their listing.
    const { orchestrator, gate } = relisting({ createFailures: 1 });

    const outcome = await orchestrator.relist("ad-1");

    expect(outcome.status).toBe("failed-recoverable");
    expect(gate.reports).toEqual([{ jti: "grant-1", outcome: "FAILED_AFTER_DELETE" }]);
  });

  it("reports against the reservation the authorization actually took", async () => {
    const { orchestrator, gate, store } = relisting({ createFailures: 1 });

    await orchestrator.relist("ad-1");

    // The snapshot carries it, so a resume hours later still owes the same
    // reservation an answer.
    expect((await store.get("ad-1"))?.grantJti).toBe("grant-1");
    expect(gate.reports.at(-1)?.jti).toBe("grant-1");
  });

  it("does not let a failed report turn a finished relist into a failure", async () => {
    // The relist already happened. A backend that cannot be told is the
    // reconciliation job's problem (#24), not the user's.
    const gate = new FakeRelistPermission();
    gate.report = async () => {
      throw new Error("the backend is down");
    };
    const { orchestrator } = relisting({ gate });

    // The quota is unknown — the call that would have said it threw — and that is
    // `null` rather than a stale number, because "we do not know" and "unchanged"
    // are different things for the strip above to render.
    await expect(orchestrator.relist("ad-1")).resolves.toEqual({ status: "relisted", quota: null });
  });
});

describe("finishing what a crash interrupted", () => {
  it("re-authorizes when finishing it could still delete something", async () => {
    // A `captured` snapshot may not have got as far as the delete, and the store
    // it came from is one the user can write (ADR-0007). So it is a relist like
    // any other and needs a grant of its own.
    const { orchestrator, store, gate } = relisting({ createFailures: 1 });
    await orchestrator.relist("ad-1");
    await store.save({ ...(await store.get("ad-1"))!, phase: "captured" });

    await orchestrator.retry("ad-1");

    expect(gate.authorized).toEqual(["ad-1", "ad-1"]);
    expect(gate.reports.at(-1)).toEqual({ jti: "grant-2", outcome: "SUCCESS" });
  });

  it("and refuses to touch anything when that authorization is denied", async () => {
    const gate = new FakeRelistPermission((_adId, nth) =>
      nth === 1
        ? {
            decision: "proceed",
            grant: { authToken: "t", expiresAt: "2026-08-20T10:00:45.000Z", jti: "grant-1" },
          }
        : { decision: "refuse", locked: { state: "upgrade", resetAt: null } },
    );
    const { orchestrator, store, client } = relisting({ gate, createFailures: 1 });
    await orchestrator.relist("ad-1");
    await store.save({ ...(await store.get("ad-1"))!, phase: "captured" });

    const outcome = await orchestrator.retry("ad-1");

    expect(outcome.status).toBe("refused");
    // The snapshot is kept: the user can try again when whatever refused them has
    // passed, and it is still the only copy of their ad.
    expect(await store.get("ad-1")).not.toBeNull();
    expect(client.lastCreated()).toBeNull();
  });

  it("puts a deleted ad back without asking again", async () => {
    // The ad is already gone and all that is left is restoring it. Refusing here
    // would leave somebody's listing deleted because their quota ran out
    // mid-relist — the exact outcome ADR-0003 keeps a snapshot to prevent.
    const gate = new FakeRelistPermission((_adId, nth) =>
      nth === 1
        ? {
            decision: "proceed",
            grant: { authToken: "t", expiresAt: "2026-08-20T10:00:45.000Z", jti: "grant-1" },
          }
        : { decision: "refuse", locked: { state: "upgrade", resetAt: null } },
    );
    const { orchestrator, store, client } = relisting({ gate, createFailures: 1 });
    await orchestrator.relist("ad-1");
    expect((await store.get("ad-1"))?.phase).toBe("deleted");

    const outcome = await orchestrator.retry("ad-1");

    expect(outcome).toEqual({ status: "relisted", quota: REPORTED_QUOTA });
    expect(gate.authorized).toEqual(["ad-1"]);
    expect(client.lastCreated()).toEqual(sampleAd());
  });

  it("still settles the reservation the interrupted attempt spent", async () => {
    const { orchestrator, gate } = relisting({ createFailures: 1 });
    await orchestrator.relist("ad-1");

    await orchestrator.retry("ad-1");

    expect(gate.reports).toEqual([
      { jti: "grant-1", outcome: "FAILED_AFTER_DELETE" },
      { jti: "grant-1", outcome: "SUCCESS" },
    ]);
  });

  it("resumes everything a crash left behind, on the same terms", async () => {
    const { orchestrator, gate, store } = relisting({ createFailures: 1 });
    await orchestrator.relist("ad-1");

    const outcomes = await orchestrator.resumeAll();

    expect(outcomes).toEqual([{ status: "relisted", quota: REPORTED_QUOTA }]);
    expect(await store.get("ad-1")).toBeNull();
    expect(gate.authorized).toEqual(["ad-1"]);
  });
});
