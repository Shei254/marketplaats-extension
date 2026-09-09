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

    // `Number(…)`: a summary's `priceCents` is a number, while the capture
    // payload the fixture is built from carries its cents as a string.
    //
    // `toEqual` and not `toMatchObject`, so this also asserts what a row does
    // *not* carry: `minimumBidPriceCents` is bid activity rather than the
    // seller's floor (T67), and putting it back would fail here first.
    expect(ads).toEqual([
      {
        id: "ad-1",
        title: sampleAd().draft.title,
        priceCents: Number(sampleAd().draft.price.priceCent),
        priceType: sampleAd().draft.price.priceType,
        biddingEnabled: sampleAd().draft.price.biddingEnabled,
        // On the row since T71 (#157), and drawn as a badge. It had been on the
        // list payload all along and this type dropped it.
        reserved: sampleAd().draft.reserved,
      },
    ]);
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

  /**
   * **The Gereserveerd flag a repost would otherwise drop** (T71, #157; ADR-0028).
   *
   * A repost is delete-and-recreate (ADR-0002) and the new ad comes back
   * unreserved, so an item its seller had promised to a buyer went quietly back on
   * the open market as a side-effect of our own mechanic. `CapturedAd.reserved`
   * had been in the capture the whole time, read by nothing.
   *
   * Every case here is about *which ad gets flagged*, because the new ad's id is
   * the hard part: `createAd` answers with none, so this diffs `listMyAds` around
   * it and exactly one addition is the new ad. **Reserving the wrong one marks an
   * unrelated live listing as promised to a buyer**, which is worse than doing
   * nothing — so the two ways the diff can be unsure are tested as carefully as
   * the way it succeeds.
   *
   * The other half of the shape is the silence: none of these can change the
   * outcome. A repost that put the flag back and one that could not are both
   * `relisted`, because both of them reposted the ad.
   */
  describe("the Gereserveerd flag", () => {
    /** The ad the diff must find, minus the id — `createAd` never says which it is. */
    const newAd = (client: FakeMarktplaatsClient) => client.lastCreated();

    it("is put back on the ad a repost creates, when the original had it", async () => {
      const events: FakeEvent[] = [];
      const client = new FakeMarktplaatsClient(events, { ads: { "ad-1": sampleAd("Bank", true) } });
      const orchestrator = new RelistOrchestrator(
        client,
        new InMemorySnapshotStore(),
        new FakeRelistPermission(),
        new FakePace(),
      );

      const outcome = await orchestrator.relist("ad-1");

      expect(outcome).toEqual({ status: "relisted", quota: REPORTED_QUOTA });
      // The new ad, and not the one that was deleted: the reserve lands on the id
      // the diff found, which is the whole mechanism.
      const created = events.find((event) => event.type === "create");
      expect(events).toContainEqual({ type: "reserve", listingId: created?.newId });
      expect(newAd(client)?.draft.reserved).toBe(true);
    });

    /**
     * The common case, and the one that must cost nothing: an ordinary ad makes
     * no extra call at all — not the reserve, and not the two list calls the diff
     * is taken from.
     */
    it("costs an unreserved ad no extra call", async () => {
      const events: FakeEvent[] = [];
      const client = new FakeMarktplaatsClient(events, {
        ads: { "ad-1": sampleAd() },
        // A client that throws if listed at all. Nothing else in a relist lists
        // ads, so reaching `relisted` is the proof that the diff was never taken
        // — an assertion rather than a hope about a call that is hard to count.
        listError: new Error("listMyAds must not be called for an unreserved ad"),
      });
      const orchestrator = new RelistOrchestrator(
        client,
        new InMemorySnapshotStore(),
        new FakeRelistPermission(),
        new FakePace(),
      );

      const outcome = await orchestrator.relist("ad-1");

      expect(outcome).toEqual({ status: "relisted", quota: REPORTED_QUOTA });
      expect(events.filter((event) => event.type === "reserve")).toEqual([]);
      expect(newAd(client)?.draft.reserved).toBe(false);
    });

    /**
     * **More than one addition means somebody posted an ad by hand in another tab
     * during the window** — or, the hazard written down rather than remembered, a
     * second repost's create interleaved with this one's diff. Either way there is
     * no way to tell which of them is ours, and flagging a guess would mark an
     * unrelated *live* listing as promised to a buyer.
     */
    it("flags nothing when the repost is not the only ad that appeared", async () => {
      const events: FakeEvent[] = [];
      const client = new FakeMarktplaatsClient(events, {
        ads: { "ad-1": sampleAd("Bank", true) },
        strayAdsOnCreate: 1,
      });
      const orchestrator = new RelistOrchestrator(
        client,
        new InMemorySnapshotStore(),
        new FakeRelistPermission(),
        new FakePace(),
      );

      const outcome = await orchestrator.relist("ad-1");

      expect(outcome).toEqual({ status: "relisted", quota: REPORTED_QUOTA });
      expect(events.filter((event) => event.type === "reserve")).toEqual([]);
      // And the ad is still live and still reposted — which is the point of the
      // silence. Losing the flag is a smaller harm than flagging a stranger's ad.
      expect(newAd(client)?.draft.reserved).toBe(false);
    });

    /**
     * Zero additions: the list lagged, or it is paginated and the new ad landed on
     * a page nobody asked for (T37, #46). Same answer as the ambiguous case, for a
     * different reason — there is no id here at all.
     */
    it("flags nothing when the diff finds no new ad", async () => {
      const events: FakeEvent[] = [];
      const client = new FakeMarktplaatsClient(events, { ads: { "ad-1": sampleAd("Bank", true) } });
      // A list that never moves: the same ids before and after, so the diff is
      // empty however the create went.
      client.listMyAds = async () => [
        { id: "frozen", title: "Bank", priceCents: 1, priceType: "FIXED", biddingEnabled: false, reserved: true },
      ];
      const orchestrator = new RelistOrchestrator(
        client,
        new InMemorySnapshotStore(),
        new FakeRelistPermission(),
        new FakePace(),
      );

      const outcome = await orchestrator.relist("ad-1");

      expect(outcome).toEqual({ status: "relisted", quota: REPORTED_QUOTA });
      expect(events.filter((event) => event.type === "reserve")).toEqual([]);
    });

    /**
     * **A list call that throws does not fail the repost.** The ad is live and the
     * quota unit is rightly spent by the time this runs, so a listing failure that
     * turned `relisted` into `failed-recoverable` would offer the user a Retry that
     * deletes and recreates an ad which is already fine.
     */
    it("still reposts when the ads cannot be listed at all", async () => {
      const events: FakeEvent[] = [];
      const client = new FakeMarktplaatsClient(events, {
        ads: { "ad-1": sampleAd("Bank", true) },
        listError: new Error("marktplaats said no"),
      });
      const orchestrator = new RelistOrchestrator(
        client,
        new InMemorySnapshotStore(),
        new FakeRelistPermission(),
        new FakePace(),
      );

      const outcome = await orchestrator.relist("ad-1");

      expect(outcome).toEqual({ status: "relisted", quota: REPORTED_QUOTA });
      expect(events.filter((event) => event.type === "reserve")).toEqual([]);
      expect(client.has("ad-1")).toBe(false);
    });

    /**
     * And the third of the three cases the log line distinguishes: the diff found
     * the ad and the `PUT` itself failed. Still `relisted`, still `SUCCESS` —
     * reporting `FAILED_AFTER_DELETE` because a flag did not stick would lie to
     * the breakage canary (ADR-0028).
     */
    it("still reposts, and still reports SUCCESS, when the reserve call fails", async () => {
      const client = new FakeMarktplaatsClient([], {
        ads: { "ad-1": sampleAd("Bank", true) },
        reserveError: new Error("reserve refused"),
      });
      const gate = new FakeRelistPermission();
      const orchestrator = new RelistOrchestrator(
        client,
        new InMemorySnapshotStore(),
        gate,
        new FakePace(),
      );

      const outcome = await orchestrator.relist("ad-1");

      expect(outcome).toEqual({ status: "relisted", quota: REPORTED_QUOTA });
      expect(gate.reports).toEqual([{ jti: "grant-1", outcome: "SUCCESS" }]);
    });

    /**
     * A relist that crashed and was resumed hours later re-reserves too, because
     * `reserved` rides in the durable snapshot (ADR-0003) and the reserve lives in
     * `createFromSnapshot` — which the fresh path, `retry()` and `resumeSnapshot()`
     * all share. Putting it in `relist()` would have made the flag a property of
     * how the repost was started rather than of the ad.
     */
    it("survives a crash: a resumed repost re-reserves", async () => {
      const events: FakeEvent[] = [];
      const ad = sampleAd("Bank", true);
      const client = new FakeMarktplaatsClient(events, { ads: {} }); // already deleted
      const store = new InMemorySnapshotStore();
      store.seed({
        listingId: "ad-1",
        draft: ad.draft,
        photos: ad.photos,
        phase: "deleted",
        createdAt: 1,
      });
      const orchestrator = new RelistOrchestrator(
        client,
        store,
        new FakeRelistPermission(),
        new FakePace(),
      );

      const [outcome] = await orchestrator.resumeAll();

      expect(outcome?.status).toBe("relisted");
      expect(newAd(client)?.draft.reserved).toBe(true);
    });

    /**
     * The badge exists because of this: `reserved` had been on the list row all
     * along and `toListingSummary` dropped it, so nothing on the screen said an ad
     * the seller had promised was about to be deleted and posted again.
     */
    it("crosses into the popup's own list", async () => {
      const client = new FakeMarktplaatsClient([], {
        ads: { "ad-1": sampleAd("Bank", true), "ad-2": sampleAd("Stoel") },
      });
      const orchestrator = new RelistOrchestrator(
        client,
        new InMemorySnapshotStore(),
        new FakeRelistPermission(),
        new FakePace(),
      );

      expect((await orchestrator.listAds()).map((ad) => [ad.id, ad.reserved])).toEqual([
        ["ad-1", true],
        ["ad-2", false],
      ]);
    });
  });
});
