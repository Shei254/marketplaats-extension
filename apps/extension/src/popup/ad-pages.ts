import type { ListingSummary } from "../domain/types";
import type { WorkerPort } from "./screen";

/**
 * The **Ad page** on the screen, and the **Saved position** that brings a seller
 * back to one (see `docs/glossary.md`).
 *
 * **Why a page number can be trusted after a repost.** A repost takes one ad out
 * and puts its copy at the top, so everything *after* that ad keeps its place. The
 * next ad and the pages beyond it have not moved, which is what lets one request
 * land on them at any account size. Ads before it shift down by one, so one can
 * cross onto the following page until that page is fetched again. Accepted, since
 * keeping that exact would cost a fetch per repost.
 */
export interface SavedPosition {
  page: number;
  /** Learned from page 1's answer and needed to ask for any other page without it. */
  batchSize: number;
  /** `null` when there is no particular ad to carry on from: the top of the page. */
  nextAdId: string | null;
}

export interface AdPage {
  number: number;
  batchSize: number;
  last: number;
  /** The row to open at; `null` for the top of the page. */
  landOn: string | null;
}

export function lastPage(total: number, batchSize: number): number {
  return batchSize > 0 ? Math.max(1, Math.ceil(total / batchSize)) : 1;
}

/**
 * Where a seller carries on from once `listingId` has gone. Worked out when the
 * button is clicked: closing the popup mid-repost leaves nothing to do it later.
 *
 * After the last row of a page that is the next page, whose first ad is not known
 * yet. After the last row of the last page the round is over, and the next one
 * starts from the top.
 */
export function positionAfter(rows: ListingSummary[], listingId: string, page: AdPage): SavedPosition {
  const next = rows[rows.findIndex((ad) => ad.id === listingId) + 1];
  const { batchSize } = page;
  if (next) return { page: page.number, batchSize, nextAdId: next.id };
  return { page: page.number < page.last ? page.number + 1 : 1, batchSize, nextAdId: null };
}

/**
 * Read back **checked**: storage outlives the code that wrote it and the user can
 * edit it (ADR-0007), so anything malformed is no position rather than a request
 * for page `NaN`.
 */
export function readPosition(stored: unknown): SavedPosition | null {
  if (typeof stored !== "object" || stored === null) return null;
  const { page, batchSize, nextAdId } = stored as Record<string, unknown>;
  const count = (value: unknown) => Number.isInteger(value) && (value as number) >= 1;
  if (!count(page) || !count(batchSize)) return null;
  if (nextAdId !== null && typeof nextAdId !== "string") return null;
  return { page: page as number, batchSize: batchSize as number, nextAdId };
}

/**
 * One page of ads. Page 1 is the request with no parameters, and its length is the
 * batch size wherever there is more than one page.
 *
 * A page past the end means the list shrank since it was saved, so the last page
 * answers instead. Only an **empty** answer counts as past the end: a payload with
 * no total reads as having no further pages, and that must not move a seller off
 * rows they were just given.
 */
export async function fetchAdPage(
  worker: Pick<WorkerPort, "ads">,
  number: number,
  batchSize: number,
): Promise<{ ads: ListingSummary[]; total: number; page: AdPage }> {
  const answer = number <= 1 ? await worker.ads() : await worker.ads(number, batchSize);
  const size = number <= 1 && answer.ads.length > 0 ? answer.ads.length : batchSize;
  const last = lastPage(answer.totalNumberOfResults, size);
  if (number > 1 && answer.ads.length === 0) return fetchAdPage(worker, Math.min(number - 1, last), size);
  return {
    ads: answer.ads,
    total: answer.totalNumberOfResults,
    page: { number: Math.max(number, 1), batchSize: size, last: Math.max(last, number), landOn: null },
  };
}
