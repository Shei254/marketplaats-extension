/**
 * Core domain types for relisting (see docs/glossary.md, docs/domain-model.md).
 * The POC has no server-side domain; these describe the client-side relist only.
 */

/** A row shown in the popup's "my ads" list. */
export interface ListingSummary {
  id: string;
  title: string;
  priceCents: number;
}

/** A single photo, captured so it can be re-uploaded onto the new ad. */
export interface Photo {
  filename: string;
  mimeType: string;
  data: Uint8Array;
}

/** Everything needed to re-create an identical ad. */
export interface ListingDraft {
  title: string;
  description: string;
  priceCents: number;
  categoryId: string;
  attributes: Record<string, string>;
  location: string;
}

/** The full capture of an existing ad, ready to be re-created. */
export interface CapturedAd {
  draft: ListingDraft;
  photos: Photo[];
}

/**
 * How far a relist has progressed. Delete-first (ADR-0003):
 *  - "captured": snapshot saved, the original may or may not be deleted yet.
 *  - "deleted": the original is confirmed gone; only re-create remains.
 */
export type SnapshotPhase = "captured" | "deleted";

/** The durable pre-delete snapshot persisted before anything is removed (ADR-0003). */
export interface AdSnapshot {
  /** id of the original listing being relisted. */
  listingId: string;
  draft: ListingDraft;
  photos: Photo[];
  phase: SnapshotPhase;
  createdAt: number;
}
