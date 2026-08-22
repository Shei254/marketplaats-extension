import { describe, expect, it } from "vitest";
import { RelistOrchestrator } from "./relist-orchestrator";
import {
  FakeMarktplaatsClient,
  FakePace,
  FakeRelistPermission,
  InMemorySnapshotStore,
  refusing,
  sampleAd,
  type FakeEvent,
} from "./testing/fakes";

/** What the fake gate answers `/complete` with — see `FakeRelistPermission`. */
const REPORTED_QUOTA = { quotaRemaining: 2, resetAt: "2026-09-14T08:31:22.101Z" };

describe("RelistOrchestrator", () => {
  /**
   * The popup renders these (T30a, #39), so they have to come back rather than be
   * logged — which is what this did while its only caller was a console hook. A
   * regression to that reads on screen as "You have no active ads", for everybody,
   * silently.
   */
  it("answers with the user's own ads rather than printing them", async () => {
    const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() } });
    const orchestrator = new RelistOrchestrator(
      client,
      new InMemorySnapshotStore(),
      new FakeRelistPermission(),
      new FakePace(),
    );

    const ads = await orchestrator.listAds();

    expect(ads).toEqual([{ id: "ad-1", title: sampleAd().draft.title, priceCents: sampleAd().draft.price.priceCent }]);
  });

  /**
   * The same mistake, made twice and fixed twice: search printed its answer too,
   * which is why the popup's box could not have been built on it (T31, #40). The
   * rows are the list's own, because the button beside a match is the same button.
   */
  it("answers with the matches rather than printing them", async () => {
    const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() } });
    const orchestrator = new RelistOrchestrator(
      client,
      new InMemorySnapshotStore(),
      new FakeRelistPermission(),
      new FakePace(),
    );

    expect(await orchestrator.searchAds(sampleAd().draft.title.slice(0, 4))).toEqual(
      await orchestrator.listAds(),
    );
    expect(await orchestrator.searchAds("nothing is called this")).toEqual([]);
  });

  it("relists an ad by deleting the original and creating a fresh identical one", async () => {
    const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() } });
    const store = new InMemorySnapshotStore();
    const gate = new FakeRelistPermission();
    const orchestrator = new RelistOrchestrator(client, store, gate, new FakePace());

    const outcome = await orchestrator.relist("ad-1");

    expect(outcome).toEqual({ status: "relisted", quota: REPORTED_QUOTA });
    expect(client.has("ad-1")).toBe(false); // original deleted
    expect(client.lastCreated()).toEqual(sampleAd()); // identical ad created
    expect(await store.get("ad-1")).toBeNull(); // snapshot cleared on success
  });

  it("persists a durable snapshot before deleting anything (delete-first)", async () => {
    const events: FakeEvent[] = [];
    const client = new FakeMarktplaatsClient(events, { ads: { "ad-1": sampleAd() } });
    const store = new InMemorySnapshotStore(events);
    const gate = new FakeRelistPermission();
    const orchestrator = new RelistOrchestrator(client, store, gate, new FakePace());

    await orchestrator.relist("ad-1");

    const firstSaveCaptured = events.findIndex(
      (e) => e.type === "save" && e.phase === "captured",
    );
    const deleteAt = events.findIndex((e) => e.type === "delete");
    const createAt = events.findIndex((e) => e.type === "create");
    const clearAt = events.findIndex((e) => e.type === "clear");

    expect(firstSaveCaptured).toBeGreaterThanOrEqual(0);
    expect(firstSaveCaptured).toBeLessThan(deleteAt); // snapshot saved before delete
    expect(deleteAt).toBeLessThan(createAt); // delete before create
    expect(createAt).toBeLessThan(clearAt); // snapshot only cleared after create
  });

  it("reports failure and leaves the original untouched when deletion fails", async () => {
    const client = new FakeMarktplaatsClient([], {
      ads: { "ad-1": sampleAd() },
      deleteError: new Error("network down"),
    });
    const store = new InMemorySnapshotStore();
    const gate = new FakeRelistPermission();
    const orchestrator = new RelistOrchestrator(client, store, gate, new FakePace());

    const outcome = await orchestrator.relist("ad-1");

    expect(outcome.status).toBe("failed-before-delete");
    expect(client.has("ad-1")).toBe(true); // original still there
    expect(await store.get("ad-1")).toBeNull(); // no orphan snapshot
  });

  it("reports failure without saving a snapshot when the ad cannot be captured", async () => {
    const client = new FakeMarktplaatsClient([], { ads: {} });
    const store = new InMemorySnapshotStore();
    const gate = new FakeRelistPermission();
    const orchestrator = new RelistOrchestrator(client, store, gate, new FakePace());

    const outcome = await orchestrator.relist("missing");

    expect(outcome.status).toBe("failed-before-delete");
    expect(await store.list()).toHaveLength(0);
  });

  it("keeps the snapshot and never loses the listing when re-create fails, then relists on retry", async () => {
    const client = new FakeMarktplaatsClient([], {
      ads: { "ad-1": sampleAd() },
      createFailures: 1, // first create throws, second succeeds
    });
    const store = new InMemorySnapshotStore();
    const gate = new FakeRelistPermission();
    const orchestrator = new RelistOrchestrator(client, store, gate, new FakePace());

    const first = await orchestrator.relist("ad-1");
    expect(first.status).toBe("failed-recoverable");
    expect(client.has("ad-1")).toBe(false); // original was deleted
    const kept = await store.get("ad-1");
    expect(kept?.phase).toBe("deleted"); // snapshot retained for recovery

    const retried = await orchestrator.retry("ad-1");
    expect(retried).toEqual({ status: "relisted", quota: REPORTED_QUOTA });
    expect(client.lastCreated()).toEqual(sampleAd()); // restored from the snapshot
    expect(await store.get("ad-1")).toBeNull();
  });

  it("resumes an interrupted relist from a 'deleted' snapshot (crash after delete)", async () => {
    // Ad was already deleted before the crash; only the snapshot remains.
    const ad = sampleAd();
    const client = new FakeMarktplaatsClient([], { ads: {} });
    const store = new InMemorySnapshotStore();
    const gate = new FakeRelistPermission();
    store.seed({
      listingId: "ad-1",
      draft: ad.draft,
      photos: ad.photos,
      phase: "deleted",
      createdAt: 1,
    });
    const orchestrator = new RelistOrchestrator(client, store, gate, new FakePace());

    const [outcome] = await orchestrator.resumeAll();

    expect(outcome?.status).toBe("relisted");
    expect(await store.get("ad-1")).toBeNull();
  });

  it("resumes from a 'captured' snapshot where the delete never happened", async () => {
    // The ad still exists (delete never ran before the crash).
    const ad = sampleAd();
    const client = new FakeMarktplaatsClient([], { ads: { "ad-1": ad } });
    const store = new InMemorySnapshotStore();
    const gate = new FakeRelistPermission();
    store.seed({
      listingId: "ad-1",
      draft: ad.draft,
      photos: ad.photos,
      phase: "captured",
      createdAt: 1,
    });
    const orchestrator = new RelistOrchestrator(client, store, gate, new FakePace());

    const [outcome] = await orchestrator.resumeAll();

    expect(outcome?.status).toBe("relisted");
    expect(client.has("ad-1")).toBe(false); // ensured deleted before re-create
    expect(await store.get("ad-1")).toBeNull();
  });
});
