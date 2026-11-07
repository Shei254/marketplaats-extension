import { beforeAll, describe, expect, it, vi } from "vitest";

import type { ListingDraft } from "../domain/types";

/** The script wires itself to `chrome` on import, which is all this stubs. */
let toListingSummary: (ad: ListingDraft) => { thumbnailUrl?: string };

beforeAll(async () => {
  vi.stubGlobal("chrome", {
    runtime: { onMessage: { addListener: vi.fn() }, sendMessage: vi.fn(async () => {}) },
  });
  ({ toListingSummary } = await import("./content-script"));
});

function row(primaryImageUrl: unknown): ListingDraft {
  return { itemId: "m1", title: "Fiets", primaryImageUrl } as ListingDraft;
}

describe("a row's thumbnail", () => {
  it("is the listing's primary image", () => {
    expect(toListingSummary(row("https://images.marktplaats.com/one.jpg")).thumbnailUrl).toBe(
      "https://images.marktplaats.com/one.jpg",
    );
  });

  it.each([[""], [null], [undefined]])("is absent when the listing's image is %j", (value) => {
    expect(toListingSummary(row(value)).thumbnailUrl).toBeUndefined();
  });
});
