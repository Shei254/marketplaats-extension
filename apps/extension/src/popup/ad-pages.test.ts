import { describe, expect, it, vi } from "vitest";

import type { ListingSummary } from "../domain/types";
import { fetchAdPage, positionAfter, readPosition, type AdPage } from "./ad-pages";

const ad = (id: string) => ({ id, title: id }) as ListingSummary;
const ON_14: AdPage = { number: 14, batchSize: 30, last: 34, landOn: null };

/** A server holding `total` ads, `size` to a page, the way `listMyAds` answers. */
function server(total: number, size: number) {
  return {
    ads: vi.fn(async (number = 1, batchSize = size) => {
      const start = (number - 1) * batchSize;
      const count = Math.max(0, Math.min(batchSize, total - start));
      return {
        ads: Array.from({ length: count }, (_, i) => ad(`m${start + i + 1}`)),
        totalNumberOfResults: total,
      };
    }),
  };
}

describe("where a seller carries on from", () => {
  it("is the next row, on the same page", () => {
    expect(positionAfter([ad("a"), ad("b")], "a", ON_14)).toEqual({ page: 14, batchSize: 30, nextAdId: "b" });
  });

  it("is the top of the next page after the page's last row", () => {
    expect(positionAfter([ad("a"), ad("b")], "b", ON_14)).toEqual({ page: 15, batchSize: 30, nextAdId: null });
  });

  it("goes back to the first page after the last row of the last page", () => {
    expect(positionAfter([ad("a")], "a", { ...ON_14, number: 34 })).toEqual({ page: 1, batchSize: 30, nextAdId: null });
  });
});

describe("a stored position", () => {
  it("is read back as written", () => {
    const position = { page: 14, batchSize: 30, nextAdId: "m411" };
    expect(readPosition(position)).toEqual(position);
    expect(readPosition({ ...position, nextAdId: null })).toEqual({ ...position, nextAdId: null });
  });

  it.each([
    undefined,
    null,
    "14",
    { page: "14", batchSize: 30, nextAdId: null },
    { page: 0, batchSize: 30, nextAdId: null },
    { page: 1.5, batchSize: 30, nextAdId: null },
    { page: 14, batchSize: 0, nextAdId: null },
    { page: 14, batchSize: 30, nextAdId: 7 },
    { page: 14, batchSize: 30 },
  ])("is no position when it holds %j", (stored) => {
    expect(readPosition(stored)).toBeNull();
  });
});

describe("fetching a page", () => {
  it("asks for page 1 with no parameters and learns the batch size from it", async () => {
    const worker = server(1000, 30);
    const { page } = await fetchAdPage(worker, 1, 0);
    expect(worker.ads).toHaveBeenCalledWith();
    expect(page).toEqual({ number: 1, batchSize: 30, last: 34, landOn: null });
  });

  it("costs one request at any depth", async () => {
    const worker = server(1000, 30);
    const { ads, page } = await fetchAdPage(worker, 14, 30);
    expect(worker.ads).toHaveBeenCalledWith(14, 30);
    expect(ads[0]?.id).toBe("m391");
    expect(page.number).toBe(14);
  });

  it("answers with the last page when the list has shrunk past the one asked for", async () => {
    const worker = server(100, 30);
    const { ads, page } = await fetchAdPage(worker, 14, 30);
    expect(page.number).toBe(4);
    expect(ads[0]?.id).toBe("m91");
    expect(worker.ads).toHaveBeenCalledTimes(2);
  });

  it("answers with page 1 when only one page is left", async () => {
    const worker = server(5, 30);
    const { page } = await fetchAdPage(worker, 14, 30);
    expect(page.number).toBe(1);
    expect(worker.ads).toHaveBeenLastCalledWith();
  });

  it("is an empty page 1 for an account with no ads", async () => {
    const { ads, page } = await fetchAdPage(server(0, 30), 1, 30);
    expect(ads).toEqual([]);
    expect(page).toMatchObject({ number: 1, last: 1 });
  });

  it("stays on a page whose answer carried rows but no usable total", async () => {
    const worker = { ads: vi.fn(async () => ({ ads: [ad("x")], totalNumberOfResults: 1 })) };
    const { page } = await fetchAdPage(worker, 14, 30);
    expect(page).toMatchObject({ number: 14, last: 14 });
  });
});
