import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChromeBatchStore, asBatchRun } from "./chrome-batch-store";
import { advanceBatch, startBatch, type BatchRun } from "../domain/batch-run";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub";

/**
 * What comes back out of storage, and what does not (T68, #147).
 *
 * **Storage is the user's**, which under ADR-0007 makes it the adversary's too,
 * and it outlives the build that wrote it. So the interesting assertions here are
 * the refusals: a run is what decides which of somebody's ads gets deleted next,
 * and reading half of one is worse than reading none — no run means nothing is
 * advanced, where a half-read one names an ad nobody selected.
 */

const NOW = 1_700_000_000_000;

function aRun(): BatchRun {
  return startBatch(["ad-1", "ad-2", "ad-3"], NOW);
}

let chromeStub: ChromeStub;

beforeEach(() => {
  chromeStub = installChromeStub();
});

afterEach(() => {
  chromeStub.restore();
});

describe("a run through storage", () => {
  it("comes back as the run that went in", async () => {
    const store = new ChromeBatchStore();
    const run = advanceBatch(aRun(), { status: "relisted", quota: null }, NOW).run;

    await store.write(run);

    await expect(store.read()).resolves.toEqual(run);
  });

  it("and nothing stored is no run rather than a failure", async () => {
    await expect(new ChromeBatchStore().read()).resolves.toBeNull();
  });

  it("and a run that has been cleared is gone", async () => {
    const store = new ChromeBatchStore();
    await store.write(aRun());

    await store.clear();

    await expect(store.read()).resolves.toBeNull();
  });
});

describe("what is not worth reading as a run", () => {
  it.each([
    ["nothing at all", undefined],
    ["a string somebody wrote by hand", "run"],
    ["an array", []],
    ["a run with no ads in it", { ...aRun(), queued: [] }],
    ["a queue holding something that is not an ad id", { ...aRun(), queued: ["ad-1", 7] }],
    ["a position past the end of the queue", { ...aRun(), at: 4 }],
    ["a position that is not whole", { ...aRun(), at: 1.5 }],
    ["a negative position", { ...aRun(), at: -1 }],
    ["outcomes that are not a list", { ...aRun(), outcomes: "reposted" }],
    ["an outcome this build has no word for", { ...aRun(), outcomes: [{ listingId: "ad-1", result: "burnt" }] }],
    ["a miss count that is not whole", { ...aRun(), misses: 0.5 }],
    ["a start time that is not a time", { ...aRun(), startedAt: "yesterday" }],
    ["a wake-up that is not a moment", { ...aRun(), nextAt: "soon" }],
    ["a stop this build has never heard of", { ...aRun(), stop: { reason: "bored", unstarted: [] } }],
    ["a stop naming ads that are not ads", { ...aRun(), stop: { reason: "stopped", unstarted: [3] } }],
  ])("refuses %s", (_shape, held) => {
    expect(asBatchRun(held)).toBeNull();
  });

  // The position may be exactly the length, because that is a finished run: every
  // ad attempted and nothing left to index.
  it("but a position at the very end is a finished run rather than a broken one", () => {
    expect(asBatchRun({ ...aRun(), at: 3, stop: { reason: "finished", unstarted: [] } })).not.toBeNull();
  });

  // The one field whose absence is ordinary, and the one that is dropped rather
  // than fatal: a run nobody has reported on has no quota, and a garbled one is a
  // number on a strip that the reload at the end of a run corrects anyway.
  it("and a quota it cannot read costs the number rather than the run", () => {
    const read = asBatchRun({ ...aRun(), quota: { quotaRemaining: "lots", resetAt: "" } });

    expect(read).not.toBeNull();
    expect(read?.quota).toBeNull();
  });

  it("and keeps one it can", () => {
    const quota = { quotaRemaining: 2, resetAt: "2026-10-01T00:00:00Z" };

    expect(asBatchRun({ ...aRun(), quota })?.quota).toEqual(quota);
  });
});
