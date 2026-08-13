import {
  AdNotFoundError,
  type MarktplaatsClient,
} from "../marktplaats-client";
import type { SnapshotStore } from "../snapshot-store";
import type {
  AdSnapshot,
  CapturedAd,
  ListingDraft,
  ListingSummary,
  Photo,
  SnapshotPhase,
} from "../types";

/** An ordered log of boundary interactions, so tests can assert delete-first ordering. */
export type FakeEvent =
  | { type: "save"; phase: SnapshotPhase; listingId: string }
  | { type: "clear"; listingId: string }
  | { type: "delete"; listingId: string }
  | { type: "create"; newId: string };

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
  ads?: Record<string, CapturedAd>;
  /** If set, deleteAd throws this instead of deleting. */
  deleteError?: Error;
  /** Number of times createAd throws before it succeeds. */
  createFailures?: number;
}

export class FakeMarktplaatsClient implements MarktplaatsClient {
  private readonly ads: Map<string, CapturedAd>;
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
      priceCents: ad.draft.priceCents,
    }));
  }

  async captureAd(listingId: string): Promise<CapturedAd> {
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

  async createAd(draft: ListingDraft, photos: Photo[]): Promise<void> {
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
  lastCreated(): CapturedAd | null {
    const created = this.events.filter((e) => e.type === "create");
    const newId = created[created.length - 1]?.newId;
    return newId ? (this.ads.get(newId) ?? null) : null;
  }
}

/** Convenience: a minimal captured ad for tests. */
export function sampleAd(title = "Vintage bike"): CapturedAd {
  return {
    draft: {
      title,
      description: "A nice bike",
      priceCents: 12000,
      categoryId: "bikes",
      attributes: { color: "blue" },
      location: "Amsterdam",
    },
    photos: [{ filename: "bike.jpg", mimeType: "image/jpeg", data: new Uint8Array([1, 2, 3]) }],
  };
}
