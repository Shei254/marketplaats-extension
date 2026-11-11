import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, CreateNotConfirmedError } from "./marktplaats-client";
import { RelistOrchestrator } from "./relist-orchestrator";
import {
  FakeMarktplaatsClient,
  FakePace,
  FakeRelistPermission,
  InMemorySnapshotStore,
  pastTheCreateWindow,
  refusing,
  sampleAd,
  type FakeEvent,
} from "./testing/fakes";

/** What the fake gate answers `/complete` with — see `FakeRelistPermission`. */
const REPORTED_QUOTA = { quotaRemaining: 2, resetAt: "2026-09-14T08:31:22.101Z" };

describe("RelistOrchestrator", () => {
  afterEach(() => vi.useRealTimers());

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

  it("relists an ad by creating a fresh identical one and then deleting the original", async () => {
    const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() } });
    const store = new InMemorySnapshotStore();
    const gate = new FakeRelistPermission();
    const orchestrator = new RelistOrchestrator(client, store, gate, new FakePace());

    const outcome = await orchestrator.relist("ad-1");

    expect(outcome).toEqual({ status: "relisted", newListingId: expect.any(String), quota: REPORTED_QUOTA });
    expect(client.has("ad-1")).toBe(false); // original deleted
    expect(client.lastCreated()).toEqual(sampleAd()); // identical ad created
    expect(await store.get("ad-1")).toBeNull(); // snapshot cleared on success
  });

  /**
   * The popup puts the copy's row at the top of the first page, and a row is only
   * pressable by an id Marktplaats knows — so the answer carries the copy's own id,
   * the one the Confirmed create named, and never the original's.
   */
  it("answers with the id of the copy it placed", async () => {
    const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() } });
    const orchestrator = new RelistOrchestrator(
      client,
      new InMemorySnapshotStore(),
      new FakeRelistPermission(),
      new FakePace(),
    );

    const outcome = await orchestrator.relist("ad-1");

    expect(client.ids()).toHaveLength(1);
    expect(outcome).toMatchObject({ status: "relisted", newListingId: client.ids()[0] });
  });

  /**
   * Marktplaats trims a title on create, so the new ad's title is not the one
   * captured. Compared as they were, the repost never found its own ad, parked
   * as unconfirmed, and the retries posted it again — three copies (2026-11-11).
   */
  it("finds the ad it created when Marktplaats trimmed the title", async () => {
    const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd("Bandrecorder 2 ") } });
    const store = new InMemorySnapshotStore();
    const orchestrator = new RelistOrchestrator(client, store, new FakeRelistPermission(), new FakePace());

    const outcome = await orchestrator.relist("ad-1");

    expect(outcome).toEqual({ status: "relisted", newListingId: expect.any(String), quota: REPORTED_QUOTA });
    expect((await orchestrator.listAds()).map((ad) => ad.title)).toEqual(["Bandrecorder 2"]);
    expect(await store.get("ad-1")).toBeNull();
  });

  it("creates the copy before deleting the original, and deletes only the id it was given", async () => {
    const events: FakeEvent[] = [];
    const client = new FakeMarktplaatsClient(events, { ads: { "ad-1": sampleAd() } });
    const store = new InMemorySnapshotStore(events);
    const orchestrator = new RelistOrchestrator(client, store, new FakeRelistPermission(), new FakePace());

    await orchestrator.relist("ad-1");

    const at = (match: (e: FakeEvent) => boolean) => events.findIndex(match);
    const creatingSaved = at((e) => e.type === "save" && e.phase === "creating");
    const createAt = at((e) => e.type === "create");
    const replacedSaved = at((e) => e.type === "save" && e.phase === "replaced");
    const deleteAt = at((e) => e.type === "delete");
    const clearAt = at((e) => e.type === "clear");

    expect(creatingSaved).toBeGreaterThanOrEqual(0);
    expect(creatingSaved).toBeLessThan(createAt);
    expect(createAt).toBeLessThan(replacedSaved); // the delete waits for a confirmed create
    expect(replacedSaved).toBeLessThan(deleteAt);
    expect(deleteAt).toBeLessThan(clearAt);
    expect(events.filter((e) => e.type === "delete")).toEqual([{ type: "delete", listingId: "ad-1" }]);
  });

  /**
   * **A duplicate the seller owns is never at risk** (ADR-0041). The delete names
   * the id the repost started from, never a match on title.
   */
  it("leaves the seller's own duplicate alone", async () => {
    const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd("Fiets"), "dup-1": sampleAd("Fiets") } });
    const orchestrator = new RelistOrchestrator(client, new InMemorySnapshotStore(), new FakeRelistPermission(), new FakePace());

    expect((await orchestrator.relist("ad-1")).status).toBe("relisted");

    expect(client.has("ad-1")).toBe(false);
    expect(client.has("dup-1")).toBe(true);
    expect((await orchestrator.listAds()).map((ad) => ad.title)).toEqual(["Fiets", "Fiets"]);
  });

  it("reports failure without holding anything when the ad cannot be captured", async () => {
    const client = new FakeMarktplaatsClient([], { ads: {} });
    const store = new InMemorySnapshotStore();
    const gate = new FakeRelistPermission();
    const orchestrator = new RelistOrchestrator(client, store, gate, new FakePace());

    const outcome = await orchestrator.relist("missing");

    expect(outcome.status).toBe("failed-before-delete");
    expect(await store.list()).toHaveLength(0);
    expect(gate.reports).toEqual([{ jti: "grant-1", outcome: "FAILED_BEFORE_DELETE" }]);
  });

  /**
   * **We never pay on a seller's behalf** (ADR-0041). A create whose chain stops
   * at a payment page placed nothing; the original was never touched, and the
   * unit goes back.
   */
  it("cannot repost an ad that would cost money, and leaves it exactly where it was", async () => {
    const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() }, createEndsOn: "payment" });
    const store = new InMemorySnapshotStore();
    const gate = new FakeRelistPermission();
    const orchestrator = new RelistOrchestrator(client, store, gate, new FakePace());

    const outcome = await orchestrator.relist("ad-1");

    expect(outcome.status).toBe("failed-before-delete");
    const error = outcome.status === "failed-before-delete" ? outcome.error : null;
    expect(error).toBeInstanceOf(CreateNotConfirmedError);
    expect((error as CreateNotConfirmedError).paymentRequired).toBe(true);
    expect(client.has("ad-1")).toBe(true);
    expect(client.creates()).toBe(0);
    expect(await store.list()).toEqual([]);
    expect(gate.reports).toEqual([{ jti: "grant-1", outcome: "FAILED_BEFORE_DELETE" }]);
  });

  it("deletes nothing when the create ends somewhere it does not recognise", async () => {
    const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() }, createEndsOn: "elsewhere" });
    const gate = new FakeRelistPermission();
    const orchestrator = new RelistOrchestrator(client, new InMemorySnapshotStore(), gate, new FakePace());

    expect((await orchestrator.relist("ad-1")).status).toBe("failed-before-delete");
    expect(client.has("ad-1")).toBe(true);
    expect(gate.reports).toEqual([{ jti: "grant-1", outcome: "FAILED_BEFORE_DELETE" }]);
  });

  it("hands a create Marktplaats refused back to the user, with the ad untouched", async () => {
    const client = new FakeMarktplaatsClient([], {
      ads: { "ad-1": sampleAd() }, createFailures: 1, createError: new ApiRequestError("createAd", 422, ""),
    });
    const store = new InMemorySnapshotStore();
    const gate = new FakeRelistPermission();
    const orchestrator = new RelistOrchestrator(client, store, gate, new FakePace());

    expect((await orchestrator.relist("ad-1")).status).toBe("failed-before-delete");
    expect(client.has("ad-1")).toBe(true);
    expect(await store.list()).toEqual([]);
    expect(gate.reports).toEqual([{ jti: "grant-1", outcome: "FAILED_BEFORE_DELETE" }]);
  });

  /**
   * **Create unconfirmed** (ADR-0041): a create that failed in a way that may pass
   * leaves the original live and the repost pending. Nothing is reported yet.
   */
  describe("a create that may pass on another try", () => {
    function failingOnce() {
      const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() }, createFailures: 1 });
      const store = new InMemorySnapshotStore();
      const gate = new FakeRelistPermission();
      return { client, store, gate, orchestrator: new RelistOrchestrator(client, store, gate, new FakePace()) };
    }

    it("leaves the original live, and holds ids rather than the ad", async () => {
      const { client, store, gate, orchestrator } = failingOnce();

      expect((await orchestrator.relist("ad-1")).status).toBe("unconfirmed");

      expect(client.has("ad-1")).toBe(true);
      const record = await store.get("ad-1");
      expect(record?.phase).toBe("creating");
      expect(record).not.toHaveProperty("draft");
      expect(record).not.toHaveProperty("photos");
      expect(gate.reports).toEqual([]);
    });

    it("keeps the photo URL for the pending row's thumbnail, and no photo itself", async () => {
      const { orchestrator } = failingOnce();
      await orchestrator.relist("ad-1");

      expect((await orchestrator.pendingReposts())[0]?.thumbnailUrl).toBe("https://example.test/bike.jpg");
    });

    it("is finished by a retry, which captures the original again", async () => {
      const { client, store, gate, orchestrator } = failingOnce();
      await orchestrator.relist("ad-1");
      client.retitle("ad-1", "Fiets, nu met bel"); // edited on Marktplaats meanwhile

      pastTheCreateWindow();
      expect(await orchestrator.retry("ad-1")).toEqual({ status: "relisted", newListingId: expect.any(String), quota: REPORTED_QUOTA });

      expect(client.lastCreated()?.draft.title).toBe("Fiets, nu met bel");
      expect(client.has("ad-1")).toBe(false);
      expect(await store.get("ad-1")).toBeNull();
      expect(gate.reports).toEqual([{ jti: "grant-1", outcome: "SUCCESS" }]);
    });

    it("waits out the create's window before sending another", async () => {
      const { client, orchestrator } = failingOnce();
      await orchestrator.relist("ad-1");

      expect((await orchestrator.resumeAll())[0]?.status).toBe("unconfirmed");
      expect(client.creates()).toBe(0);
    });

    it("is dropped, and its unit handed back, when the seller deleted the original themselves", async () => {
      const { client, store, gate, orchestrator } = failingOnce();
      await orchestrator.relist("ad-1");
      client.removeByHand("ad-1");

      pastTheCreateWindow();
      expect((await orchestrator.resumeAll())[0]?.status).toBe("failed-before-delete");
      expect(client.creates()).toBe(0);
      expect(await store.list()).toEqual([]);
      expect(gate.reports).toEqual([{ jti: "grant-1", outcome: "FAILED_BEFORE_DELETE" }]);
    });

    it("stops the background after three creates, and an explicit Opnieuw sends one more", async () => {
      const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() } });
      const store = new InMemorySnapshotStore();
      store.seed({
        phase: "creating", listingId: "ad-1", title: "Vintage bike", reserved: false, createdAt: 1,
        grantJti: "grant-0", idsBeforeCreate: ["ad-1"], createSentAt: 1, attempts: 3,
      });
      const orchestrator = new RelistOrchestrator(client, store, new FakeRelistPermission(), new FakePace());

      expect((await orchestrator.resumeAll())[0]?.status).toBe("unconfirmed");
      expect(client.creates()).toBe(0);
      expect((await store.get("ad-1"))?.needsUser).toBe(true);

      expect((await orchestrator.retry("ad-1")).status).toBe("relisted");
      expect(client.creates()).toBe(1);
    });
  });

  /**
   * **A create that failed may have worked** (ADR-0039): Marktplaats can place the
   * ad and lose the reply. It is looked for before anything else is sent.
   */
  describe("a create whose reply was lost", () => {
    it("is found straight away, and the original replaced by it", async () => {
      const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() }, lostReplies: 1 });
      const gate = new FakeRelistPermission();
      const orchestrator = new RelistOrchestrator(client, new InMemorySnapshotStore(), gate, new FakePace());

      expect(await orchestrator.relist("ad-1")).toEqual({ status: "relisted", newListingId: expect.any(String), quota: REPORTED_QUOTA });
      expect(client.creates()).toBe(1);
      expect(client.has("ad-1")).toBe(false);
      expect(gate.reports).toEqual([{ jti: "grant-1", outcome: "SUCCESS" }]);
    });

    it("is looked for again by the retry when the list could not be read, and not posted twice", async () => {
      const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() }, lostReplies: 1 });
      const store = new InMemorySnapshotStore();
      const orchestrator = new RelistOrchestrator(client, store, new FakeRelistPermission(), new FakePace());
      const listPage = client.listMyAdsPage.bind(client);
      let calls = 0;
      client.listMyAdsPage = async () => {
        if (++calls === 2) throw new Error("offline");
        return listPage();
      };

      expect((await orchestrator.relist("ad-1")).status).toBe("unconfirmed");
      expect(client.has("ad-1")).toBe(true);
      expect((await store.get("ad-1"))?.phase).toBe("creating");

      expect((await orchestrator.retry("ad-1")).status).toBe("relisted");
      expect(client.creates()).toBe(1);
      expect(client.has("ad-1")).toBe(false);
    });
  });

  /**
   * **Old ad still to delete** (ADR-0041): the create was confirmed and the delete
   * failed. The seller has two live copies, never none.
   */
  describe("a delete that fails after a confirmed create", () => {
    function deleteFailingOnce() {
      const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() }, deleteFailures: 1 });
      const store = new InMemorySnapshotStore();
      const gate = new FakeRelistPermission();
      return { client, store, gate, orchestrator: new RelistOrchestrator(client, store, gate, new FakePace()) };
    }

    it("still reposts, settles the unit as the canary, and keeps the old id to delete", async () => {
      const { client, store, gate, orchestrator } = deleteFailingOnce();

      expect(await orchestrator.relist("ad-1")).toEqual({ status: "relisted", newListingId: expect.any(String), quota: REPORTED_QUOTA });

      expect(client.has("ad-1")).toBe(true);
      expect(client.creates()).toBe(1);
      const record = await store.get("ad-1");
      expect(record?.phase).toBe("replaced");
      expect(gate.reports).toEqual([{ jti: "grant-1", outcome: "FAILED_AFTER_DELETE" }]);
      expect((await orchestrator.pendingReposts())[0]?.replaced).toBe(true);
    });

    it("is finished by the background while the new ad is live", async () => {
      const { client, store, orchestrator } = deleteFailingOnce();
      await orchestrator.relist("ad-1");

      expect((await orchestrator.resumeAll())[0]?.status).toBe("relisted");
      expect(client.has("ad-1")).toBe(false);
      expect(client.creates()).toBe(1);
      expect(await store.list()).toEqual([]);
    });

    it("never deletes the original once the seller has removed the copy", async () => {
      const { client, store, orchestrator } = deleteFailingOnce();
      await orchestrator.relist("ad-1");
      const record = await store.get("ad-1");
      client.removeByHand(record?.phase === "replaced" ? record.newListingId : "");

      await orchestrator.resumeAll();

      expect(client.has("ad-1")).toBe(true);
      expect(await store.list()).toEqual([]);
    });
  });

  /**
   * **A seller's only ad** (#189). Under delete-first, deleting it left a list that
   * was rightly empty, and reading that as "could not tell" parked the repost
   * forever. Create-first keeps the original listed throughout, but the edges the
   * fix found still have to hold.
   */
  describe("a seller's only ad", () => {
    it("is reposted", async () => {
      const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() } });
      const store = new InMemorySnapshotStore();
      const orchestrator = new RelistOrchestrator(client, store, new FakeRelistPermission(), new FakePace());

      expect(await orchestrator.relist("ad-1")).toEqual({ status: "relisted", newListingId: expect.any(String), quota: REPORTED_QUOTA });
      expect(client.ids()).toEqual(["new-1"]);
      expect(await store.get("ad-1")).toBeNull();
    });

    it("is left alone when the list comes back empty while counting ads", async () => {
      const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() } });
      client.listMyAdsPage = async () => ({ ads: [], totalNumberOfResults: 3 });
      const store = new InMemorySnapshotStore();
      const orchestrator = new RelistOrchestrator(client, store, new FakeRelistPermission(), new FakePace());

      expect((await orchestrator.relist("ad-1")).status).toBe("failed-before-delete");
      expect(client.creates()).toBe(0);
      expect(client.has("ad-1")).toBe(true);
      expect(await store.list()).toEqual([]);
    });

    /**
     * The one that would be fatal under create-first: an original missing from
     * the ids taken before the create, read back as "the new copy", is deleted as
     * replaced — and it is the only ad there is.
     */
    it("is never taken for its own copy and deleted", async () => {
      const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() } });
      const store = new InMemorySnapshotStore();
      store.seed({
        phase: "creating", listingId: "ad-1", title: "Vintage bike", reserved: false, createdAt: 1,
        idsBeforeCreate: [], createSentAt: 1, attempts: 1,
      });
      const orchestrator = new RelistOrchestrator(client, store, new FakeRelistPermission(), new FakePace());

      expect((await orchestrator.retry("ad-1")).status).toBe("relisted");
      expect(client.creates()).toBe(1);
      expect(client.ids()).toEqual(["new-1"]);
    });
  });

  /**
   * **ADR-0003's snapshots, carried over by an update** (ADR-0041). For a seller
   * who updates with one of these pending, the ad is gone and this is its only
   * copy, so they are finished the old way and never written again.
   */
  describe("a delete-first snapshot from before the update", () => {
    it("puts a 'deleted' one back from what it stored", async () => {
      const ad = sampleAd();
      const client = new FakeMarktplaatsClient([], { ads: {} });
      const store = new InMemorySnapshotStore();
      store.seed({ listingId: "ad-1", draft: ad.draft, photos: ad.photos, phase: "deleted", createdAt: 1 });
      const orchestrator = new RelistOrchestrator(client, store, new FakeRelistPermission(), new FakePace());

      const [outcome] = await orchestrator.resumeAll();

      expect(outcome?.status).toBe("relisted");
      expect(client.lastCreated()).toEqual(sampleAd());
      expect(await store.get("ad-1")).toBeNull();
    });

    it("cancels a 'captured' one whose delete never happened", async () => {
      const ad = sampleAd();
      const client = new FakeMarktplaatsClient([], { ads: { "ad-1": ad } });
      const store = new InMemorySnapshotStore();
      store.seed({ listingId: "ad-1", draft: ad.draft, photos: ad.photos, phase: "captured", createdAt: 1 });
      const orchestrator = new RelistOrchestrator(client, store, new FakeRelistPermission(), new FakePace());

      const [outcome] = await orchestrator.resumeAll();

      expect(outcome?.status).toBe("failed-before-delete");
      expect(client.has("ad-1")).toBe(true);
      expect(client.lastCreated()).toBeNull();
      expect(await store.get("ad-1")).toBeNull();
    });

    it("does not take a lagging list's deleted original for its copy", async () => {
      // With nothing listed before the create, the original is not among the ids
      // diffed against. Reading it as the new ad would drop the only copy (#189).
      const ad = sampleAd();
      const client = new FakeMarktplaatsClient([], { ads: { "ad-1": ad } });
      const store = new InMemorySnapshotStore();
      store.seed({
        listingId: "ad-1", draft: ad.draft, photos: ad.photos, phase: "deleted", createdAt: 1,
        idsBeforeCreate: [], createSentAt: 1,
      });
      const orchestrator = new RelistOrchestrator(client, store, new FakeRelistPermission(), new FakePace());

      expect(await orchestrator.retry("ad-1")).toEqual({ status: "relisted", newListingId: expect.any(String), quota: null });
      expect(client.creates()).toBe(1);
    });

    it("keeps a 'deleted' one whose create fails, and settles the unit it spent", async () => {
      const ad = sampleAd();
      const client = new FakeMarktplaatsClient([], { ads: {}, createFailures: 1 });
      const store = new InMemorySnapshotStore();
      const gate = new FakeRelistPermission();
      store.seed({ listingId: "ad-1", draft: ad.draft, photos: ad.photos, phase: "deleted", createdAt: 1, grantJti: "grant-0" });
      const orchestrator = new RelistOrchestrator(client, store, gate, new FakePace());

      expect((await orchestrator.resumeAll())[0]?.status).toBe("failed-recoverable");
      expect((await store.get("ad-1"))?.phase).toBe("deleted");
      expect(gate.reports).toEqual([{ jti: "grant-0", outcome: "FAILED_AFTER_DELETE" }]);
    });
  });

  /**
   * **Some failures retry, and some wait for the user** (ADR-0039). A create
   * Marktplaats refuses outright gets the same answer every time it is sent, so
   * it is not sent again until somebody presses Opnieuw.
   */
  /**
   * **The attempt cap stops the background, not the user.** After three creates
   * that could not be confirmed, the retries stop and the repost waits for the
   * user. An explicit Opnieuw still looks for the landed ad first, and if it is
   * not there, sends one more create.
   */
  describe("a repost that used its three create attempts", () => {
    function capped(needsUser: boolean) {
      const ad = sampleAd();
      const client = new FakeMarktplaatsClient([], { ads: {} });
      const store = new InMemorySnapshotStore();
      store.seed({
        listingId: "ad-1", draft: ad.draft, photos: ad.photos, phase: "deleted", createdAt: 1, grantJti: "grant-0",
        idsBeforeCreate: [], createSentAt: 1, attempts: 3, needsUser,
      });
      return { client, store, orchestrator: new RelistOrchestrator(client, store, new FakeRelistPermission(), new FakePace()) };
    }

    it("is not created again by the background", async () => {
      const { client, store, orchestrator } = capped(false);

      expect((await orchestrator.resumeAll())[0]?.status).toBe("unconfirmed");
      expect(client.creates()).toBe(0);
      expect((await store.get("ad-1"))?.needsUser).toBe(true);
    });

    it("gets one more create from an explicit Opnieuw", async () => {
      const { client, store, orchestrator } = capped(true);

      expect((await orchestrator.retry("ad-1")).status).toBe("relisted");
      expect(client.creates()).toBe(1);
      expect(await store.get("ad-1")).toBeNull();
    });
  });

  /**
   * **A resume runs beside reposts, not through them** (ADR-0039). It fires on
   * every marktplaats.nl page load, so it will meet a repost that is between its
   * delete and its create — whose snapshot looks exactly like an interrupted one.
   */
  describe("a resume while a repost is running", () => {
    it("leaves that repost alone", async () => {
      const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() } });
      const orchestrator = new RelistOrchestrator(client, new InMemorySnapshotStore(), new FakeRelistPermission(), new FakePace());
      const release = client.holdCreates();
      const creating = client.whenCreating();
      const reposting = orchestrator.relist("ad-1");
      await creating;

      expect(await orchestrator.resumeAll()).toEqual([]);

      release();
      expect((await reposting).status).toBe("relisted");
      expect(client.creates()).toBe(1);
    });

    it("runs once when it is started twice", async () => {
      const client = new FakeMarktplaatsClient([], { ads: {} });
      const store = new InMemorySnapshotStore();
      const ad = sampleAd();
      store.seed({ listingId: "ad-1", draft: ad.draft, photos: ad.photos, phase: "deleted", createdAt: 1 });
      const orchestrator = new RelistOrchestrator(client, store, new FakeRelistPermission(), new FakePace());
      const release = client.holdCreates();

      const first = orchestrator.resumeAll();
      const second = orchestrator.resumeAll();
      release();
      await Promise.all([first, second]);

      expect(client.creates()).toBe(1);
    });
  });

  /**
   * **What the popup shows of them** (ADR-0039). A `deleted` ad is not in
   * `listMyAds`, so without this a pending repost vanished with the popup that
   * started it.
   */
  describe("pending reposts", () => {
    it("are listed with what the row needs, and which state they are in", async () => {
      const client = new FakeMarktplaatsClient([], { ads: {} });
      const store = new InMemorySnapshotStore();
      store.seed({
        phase: "creating", listingId: "ad-1", title: "Fiets", reserved: false, createdAt: 1,
        idsBeforeCreate: [], createSentAt: 1, attempts: 1, failure: "server",
      });
      store.seed({ phase: "replaced", listingId: "ad-2", title: "Stoel", createdAt: 1, newListingId: "new-9", needsUser: true });
      const orchestrator = new RelistOrchestrator(client, store, new FakeRelistPermission(), new FakePace());

      expect(await orchestrator.pendingReposts()).toEqual([
        { listingId: "ad-1", title: "Fiets", needsUser: false, running: false, deleted: false, replaced: false, failure: "server" },
        { listingId: "ad-2", title: "Stoel", needsUser: true, running: false, deleted: false, replaced: true, failure: undefined },
      ]);
    });

    it("can be let go, which drops the record and nothing else", async () => {
      const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() }, createFailures: 1 });
      const gate = new FakeRelistPermission();
      const orchestrator = new RelistOrchestrator(client, new InMemorySnapshotStore(), gate, new FakePace());
      await orchestrator.relist("ad-1");

      expect(await orchestrator.letGo("ad-1")).toBe(true);

      expect(await orchestrator.pendingReposts()).toEqual([]);
      expect(gate.reports).toEqual([]);
      expect(client.creates()).toBe(0);
      expect(client.has("ad-1")).toBe(true);
    });

    it("cannot be let go while it is being put back", async () => {
      const client = new FakeMarktplaatsClient([], { ads: { "ad-1": sampleAd() } });
      const orchestrator = new RelistOrchestrator(client, new InMemorySnapshotStore(), new FakeRelistPermission(), new FakePace());
      const release = client.holdCreates();
      const creating = client.whenCreating();
      const reposting = orchestrator.relist("ad-1");
      await creating;

      expect((await orchestrator.pendingReposts()).map((p) => p.running)).toEqual([true]);
      expect(await orchestrator.letGo("ad-1")).toBe(false);

      release();
      expect((await reposting).status).toBe("relisted");
    });
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
   * the hard part: `createAd` answers with none, so the ad is found in the list
   * afterwards — new since the create, and carrying the snapshot's title.
   * **Reserving the wrong one marks an unrelated live listing as promised to a
   * buyer**, which is worse than doing nothing — so the ways the search can come
   * up empty are tested as carefully as the way it succeeds.
   *
   * A failed reserve call never changes the outcome: the ad was reposted. But an
   * ad that cannot be found, or a list that cannot be read, is not a repost at
   * all since the create-ad guards — those are `unconfirmed`.
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

      expect(outcome).toEqual({ status: "relisted", newListingId: expect.any(String), quota: REPORTED_QUOTA });
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
    it("flags nothing on an ad that was not reserved", async () => {
      const events: FakeEvent[] = [];
      const client = new FakeMarktplaatsClient(events, { ads: { "ad-1": sampleAd() } });
      const orchestrator = new RelistOrchestrator(
        client,
        new InMemorySnapshotStore(),
        new FakeRelistPermission(),
        new FakePace(),
      );

      const outcome = await orchestrator.relist("ad-1");

      expect(outcome).toEqual({ status: "relisted", newListingId: expect.any(String), quota: REPORTED_QUOTA });
      expect(events.filter((event) => event.type === "reserve")).toEqual([]);
      expect(newAd(client)?.draft.reserved).toBe(false);
    });

    /**
     * **Another ad appearing during the window is not ours.** Since the create-ad
     * guards the new ad is the one carrying the snapshot's title, so a stranger's
     * ad posted in another tab meanwhile is told apart by its title — and only the
     * repost's own ad is flagged. Flagging the wrong one would mark an unrelated
     * *live* listing as promised to a buyer.
     */
    it("flags the ad carrying the reposted title, not one that appeared beside it", async () => {
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

      expect(outcome).toEqual({ status: "relisted", newListingId: expect.any(String), quota: REPORTED_QUOTA });
      const created = events.find((event) => event.type === "create");
      expect(events.filter((event) => event.type === "reserve")).toEqual([
        { type: "reserve", listingId: created?.newId },
      ]);
      expect((await orchestrator.listAds()).find((ad) => ad.title === "Somebody else's ad")?.reserved).toBe(false);
    });

    /**
     * **The flag lands on the id the create named** (ADR-0041), so a list that
     * never shows the new ad — lag, or a page nobody asked for (T37, #46) — no
     * longer costs the flag or the repost.
     */
    it("flags the ad the create named, even when the list never shows it", async () => {
      const events: FakeEvent[] = [];
      const client = new FakeMarktplaatsClient(events, { ads: { "ad-1": sampleAd("Bank", true) } });
      client.listMyAds = async () => [
        { id: "frozen", title: "Bank", priceCents: 1, priceType: "FIXED", biddingEnabled: false, reserved: true },
      ];
      const orchestrator = new RelistOrchestrator(client, new InMemorySnapshotStore(), new FakeRelistPermission(), new FakePace());

      expect(await orchestrator.relist("ad-1")).toEqual({ status: "relisted", newListingId: expect.any(String), quota: REPORTED_QUOTA });
      const created = events.find((event) => event.type === "create");
      expect(events).toContainEqual({ type: "reserve", listingId: created?.newId });
    });

    /**
     * **A list that cannot be read means no create**: without the ids from before,
     * a lost reply could not be told from a failure, and sending one anyway is how
     * an ad gets posted twice. Nothing has been deleted, so the unit goes back.
     */
    it("creates and deletes nothing when the ads cannot be listed", async () => {
      const events: FakeEvent[] = [];
      const store = new InMemorySnapshotStore();
      const client = new FakeMarktplaatsClient(events, {
        ads: { "ad-1": sampleAd("Bank", true) },
        listError: new Error("marktplaats said no"),
      });
      const gate = new FakeRelistPermission();
      const orchestrator = new RelistOrchestrator(client, store, gate, new FakePace());

      expect((await orchestrator.relist("ad-1")).status).toBe("failed-before-delete");
      expect(client.creates()).toBe(0);
      expect(client.has("ad-1")).toBe(true);
      expect(await store.list()).toEqual([]);
      expect(gate.reports).toEqual([{ jti: "grant-1", outcome: "FAILED_BEFORE_DELETE" }]);
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

      expect(outcome).toEqual({ status: "relisted", newListingId: expect.any(String), quota: REPORTED_QUOTA });
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
