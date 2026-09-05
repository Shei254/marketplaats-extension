import type { RelistOutcomeCode, RemainingQuota } from "@mprelist/contracts";

import type { GateDecision, LockedState } from "../../gate/authorization-gate";
import type { RelistPermission } from "../../gate/relist-permission";
import {
  AdNotFoundError,
  type MarktplaatsClient,
} from "../marktplaats-client";
import type { RelistPacing } from "../relist-pace";
import type { SnapshotStore } from "../snapshot-store";
import type {
  AdSnapshot,
  CapturedAd,
  CapturedListing,
  ListingSummary,
  Photo,
  SnapshotPhase,
} from "../types";

/**
 * The gate, faked (T26, #35). Answers `proceed` with a fresh reservation each time
 * unless a test says otherwise, and records every outcome reported back — which is
 * where the assertions about settling and refunding live.
 */
export class FakeRelistPermission implements RelistPermission {
  readonly authorized: string[] = [];

  /** Which of those said they were part of a batch (T68, #147). */
  readonly asBatch: string[] = [];
  readonly reports: Array<{ jti: string; outcome: RelistOutcomeCode }> = [];

  constructor(
    private readonly answer: (adId: string, nth: number) => GateDecision = (_adId, nth) => ({
      decision: "proceed",
      grant: { authToken: `token-${nth}`, expiresAt: "2026-08-20T10:00:45.000Z", jti: `grant-${nth}` },
    }),
    private readonly events: FakeEvent[] = [],
  ) {}

  async authorize(adId: string, batch = false): Promise<GateDecision> {
    this.authorized.push(adId);
    if (batch) this.asBatch.push(adId);
    this.events.push({ type: "authorize", listingId: adId });
    return this.answer(adId, this.authorized.length);
  }

  /** Answers with the quota `/complete` would, which the popup renders without asking again (#41). */
  quotaAfterReporting: RemainingQuota | null = { quotaRemaining: 2, resetAt: "2026-09-14T08:31:22.101Z" };

  async report(jti: string, outcome: RelistOutcomeCode): Promise<RemainingQuota | null> {
    this.reports.push({ jti, outcome });
    return this.quotaAfterReporting;
  }
}

/** A gate that refuses everything, with the state the row would show. */
export function refusing(
  locked: LockedState = { state: "upgrade", resetAt: null },
  events: FakeEvent[] = [],
): FakeRelistPermission {
  return new FakeRelistPermission(() => ({ decision: "refuse", locked }), events);
}

/**
 * The pace, faked (T46, #54): it records rather than sleeps, so a suite about
 * ordering does not take a minute and a half per relist.
 *
 * `waitMs` is what the real one would have slept for, and is 0 by default —
 * every test that is not about pacing gets a pacer that waits for nothing, which
 * is the same shape the real one has when enough time has already passed.
 */
export class FakePace implements RelistPacing {
  constructor(
    private readonly events: FakeEvent[] = [],
    public waitMs = 0,
  ) {}

  async pause(): Promise<void> {
    this.events.push({ type: "pace", waited: this.waitMs });
  }

  async startedRelisting(): Promise<void> {
    this.events.push({ type: "paced" });
  }

  async msBeforeNextRelist(): Promise<number> {
    return this.waitMs;
  }
}

/** An ordered log of boundary interactions, so tests can assert delete-first ordering. */
export type FakeEvent =
  | { type: "save"; phase: SnapshotPhase; listingId: string }
  | { type: "clear"; listingId: string }
  | { type: "delete"; listingId: string }
  | { type: "create"; newId: string }
  /** The gap was waited out, and how long it would have been (T46, #54). */
  | { type: "pace"; waited: number }
  /** A relist took its turn, which is what the next gap is measured from. */
  | { type: "paced" }
  /**
   * Permission was asked for. Here rather than only in
   * {@link FakeRelistPermission#authorized} so that the pace and the
   * authorization can be put in one order — which is the whole of what T46
   * changed about this flow.
   */
  | { type: "authorize"; listingId: string };

export class InMemorySnapshotStore implements SnapshotStore {
  private readonly map = new Map<string, AdSnapshot>();

  constructor(private readonly events: FakeEvent[] = []) {}

  async save(snapshot: AdSnapshot): Promise<void> {
    this.events.push({ type: "save", phase: snapshot.phase, listingId: snapshot.listingId });
    this.map.set(snapshot.listingId, structuredClone(snapshot));
  }

  async get(listingId: string): Promise<AdSnapshot | null> {
    const found = this.map.get(listingId);
    return found ? structuredClone(found) : null;
  }

  async list(): Promise<AdSnapshot[]> {
    return [...this.map.values()].map((s) => structuredClone(s));
  }

  async clear(listingId: string): Promise<void> {
    this.events.push({ type: "clear", listingId });
    this.map.delete(listingId);
  }

  /** Test helper: seed a snapshot without emitting a save event. */
  seed(snapshot: AdSnapshot): void {
    this.map.set(snapshot.listingId, structuredClone(snapshot));
  }
}

export interface FakeClientOptions {
  ads?: Record<string, CapturedListing>;
  /** If set, deleteAd throws this instead of deleting. */
  deleteError?: Error;
  /** Number of times createAd throws before it succeeds. */
  createFailures?: number;
}

export class FakeMarktplaatsClient implements MarktplaatsClient {
  private readonly ads: Map<string, CapturedListing>;
  private createFailuresLeft: number;
  private nextId = 1;

  constructor(
    private readonly events: FakeEvent[] = [],
    private readonly opts: FakeClientOptions = {},
  ) {
    this.ads = new Map(Object.entries(opts.ads ?? {}));
    this.createFailuresLeft = opts.createFailures ?? 0;
  }

  async listMyAds(): Promise<ListingSummary[]> {
    return [...this.ads.entries()].map(([id, ad]) => ({
      id,
      title: ad.draft.title,
      // The two ends of this disagree on the wire: the capture payload's
      // `priceCent` is a string and the list payload's `priceCents` is a number.
      // Production never crosses them — `content-script.ts` builds the summary
      // from `ListingDraft` — so the conversion lives here, in the fake.
      //
      // `minimumBidPriceCent` deliberately does not come across (T67): the real
      // summary has no such field, and a fake that offered one would be the only
      // place in the suite where a bid floor exists to be read.
      priceCents: Number(ad.draft.price.priceCent),
      priceType: ad.draft.price.priceType,
      biddingEnabled: ad.draft.price.biddingEnabled,
    }));
  }

  /**
   * Substring match on title — enough to stand in for Marktplaats's own
   * filtering, and it answers with the rows `listMyAds` does, since a search
   * result is relisted by the same button (T31, #40).
   */
  async searchAd(query: string): Promise<ListingSummary[]> {
    const needle = query.toLowerCase();
    return (await this.listMyAds()).filter((ad) => ad.title.toLowerCase().includes(needle));
  }

  async captureAd(listingId: string): Promise<CapturedListing> {
    const ad = this.ads.get(listingId);
    if (!ad) throw new AdNotFoundError(listingId);
    return structuredClone(ad);
  }

  async deleteAd(listingId: string): Promise<void> {
    if (this.opts.deleteError) throw this.opts.deleteError;
    if (!this.ads.has(listingId)) throw new AdNotFoundError(listingId);
    this.ads.delete(listingId);
    this.events.push({ type: "delete", listingId });
  }

  async createAd(draft: CapturedAd, photos: Photo[]): Promise<void> {
    if (this.createFailuresLeft > 0) {
      this.createFailuresLeft -= 1;
      throw new Error("create failed");
    }
    // The real client gets no id back from Marktplaats; the fake still needs one
    // internally to keep holding the ad, but never hands it to the caller.
    const id = `new-${this.nextId++}`;
    this.ads.set(id, { draft, photos });
    this.events.push({ type: "create", newId: id });
  }

  /** Test helper: does an ad with this id currently exist? */
  has(listingId: string): boolean {
    return this.ads.has(listingId);
  }

  /** Test helper: the most recently created ad, or null if none was created. */
  lastCreated(): CapturedListing | null {
    const created = this.events.filter((e) => e.type === "create");
    const newId = created[created.length - 1]?.newId;
    return newId ? (this.ads.get(newId) ?? null) : null;
  }
}

/**
 * Convenience: a captured ad for tests.
 *
 * `CapturedAd` is Marktplaats's own ad representation, so this fixture is
 * necessarily wide. The orchestrator treats the draft as opaque — it captures it,
 * persists it, and hands it back to createAd unchanged — so only `itemId`,
 * `title` and `price.priceCent` are read by anything under test. The rest is
 * filled in so the fixture stays a real `CapturedAd` and future field changes
 * surface here rather than being hidden behind a cast.
 */
export function sampleAd(title = "Vintage bike"): CapturedListing {
  return {
    draft: {
      itemId: "ad-1",
      title,
      description: "A nice bike",
      price: {
        biddingEnabled: false,
        priceCent: "12000",
        priceType: "FIXED",
        minimumBidPriceCent: "0",
      },
      categoryInformation: {
        categoryId: 1234,
        categoryName: "Fietsen",
        parentCategoryId: 12,
        parentCategoryName: "Fietsen en Brommers",
        verticals: [],
      },
      contactInformation: { name: "Test Seller", postcode: "1011AB", phone: "0612345678" },
      gallery: { imageUrls: ["https://example.test/bike.jpg"] },
      attributes: [],
      adFeatures: [],
      shippingInformation: { augmentedLabels: [], selectedShippingOptions: [] },
      shippingServices: [],
      bucketId: 9,
      adViews: 0,
      buyItNowEnabled: false,
      closeDate: 0,
      startDate: 0,
      deliveryMethod: "SHIPPING",
      editable: true,
      escrowAllowed: false,
      isBuyerProtectionActiveOnListing: false,
      isCarAd: false,
      isMultiLingual: false,
      phoneUpcallAllowed: false,
      reserved: false,
      showTAMSurvey: false,
      suspended: false,
    },
    photos: [{ filename: "bike.jpg", mimeType: "image/jpeg", data: new Uint8Array([1, 2, 3]) }],
  };
}
