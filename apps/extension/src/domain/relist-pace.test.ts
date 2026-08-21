import { describe, expect, it } from "vitest";

import { RelistOrchestrator } from "./relist-orchestrator";
import {
  drawGap,
  gapLeft,
  HUMAN_PACE,
  RelistPacer,
  type PaceMemory,
  type PacingWindow,
} from "./relist-pace";
import {
  FakeMarktplaatsClient,
  FakePace,
  FakeRelistPermission,
  InMemorySnapshotStore,
  refusing,
  sampleAd,
  type FakeEvent,
} from "./testing/fakes";

/**
 * The human-shaped gap between relists (T46, #54).
 *
 * Two halves, and the second is the one that would break silently: the pacer's own
 * arithmetic, and then the orchestrator's use of it — *when* it waits and what it
 * counts as an action worth spacing. A pacer that worked perfectly and was called
 * after the authorization instead of before it would pass every test in the first
 * half and space nothing that matters.
 */
const WINDOW: PacingWindow = { minMs: 40_000, maxMs: 80_000 };

class Remembered implements PaceMemory {
  constructor(public at: number | null = null) {}

  async read(): Promise<number | null> {
    return this.at;
  }

  async write(nextAllowedAt: number): Promise<void> {
    this.at = nextAllowedAt;
  }
}

/** A pacer whose clock, dice and sleep are all the test's. */
function pacer(memory: Remembered, dice: number[] = [0.5], now = 1_000_000) {
  const slept: number[] = [];
  const rolls = [...dice];
  const it = new RelistPacer(
    memory,
    WINDOW,
    () => now,
    () => rolls.shift() ?? 0.5,
    async (ms) => {
      slept.push(ms);
    },
  );
  return { it, slept };
}

describe("the gap that is drawn", () => {
  it("falls inside the window, wherever the dice land", () => {
    expect(drawGap(WINDOW, () => 0)).toBe(40_000);
    expect(drawGap(WINDOW, () => 1)).toBe(80_000);
    expect(drawGap(WINDOW, () => 0.5)).toBe(60_000);
  });

  it("is not the same number twice, which is the whole point of it", () => {
    // A constant 60s gap is as machine-shaped as no gap at all, only slower — it
    // is the rhythm a detector would have to miss, not the speed (ADR-0008).
    const gaps = [0.1, 0.37, 0.62, 0.94].map((roll) => drawGap(WINDOW, () => roll));

    expect(new Set(gaps).size).toBe(gaps.length);
  });

  it("survives a random source that is not one", () => {
    // Nothing in the extension hands it one. But a draw that came back NaN would
    // become a deadline of NaN, and `gapLeft` would then answer 0 for ever —
    // pacing switched off by arithmetic rather than by a decision.
    expect(drawGap(WINDOW, () => Number.NaN)).toBe(40_000);
    expect(drawGap(WINDOW, () => 7)).toBe(80_000);
  });

  it("refuses a window that runs backwards", () => {
    expect(() => drawGap({ minMs: 90_000, maxMs: 45_000 }, () => 0.5)).toThrow(/run forwards/);
  });
});

describe("what is left of the gap", () => {
  it("is nothing at all when no relist has happened yet", () => {
    expect(gapLeft(null, 1_000_000, WINDOW)).toBe(0);
  });

  it("is nothing once the deadline has passed", () => {
    expect(gapLeft(999_000, 1_000_000, WINDOW)).toBe(0);
  });

  it("is the remainder while it has not", () => {
    expect(gapLeft(1_030_000, 1_000_000, WINDOW)).toBe(30_000);
  });

  it("is never longer than the window, whatever the stored deadline says", () => {
    // The deadline is read back out of chrome.storage.local, which the user can
    // write (ADR-0007) and which outlives the build that wrote it. A machine whose
    // clock jumped forward a month would otherwise stop relisting until the
    // calendar caught up — and nothing here is a security boundary, since the only
    // person being delayed is the one who could edit the value.
    expect(gapLeft(1_000_000 + 30 * 24 * 3_600_000, 1_000_000, WINDOW)).toBe(WINDOW.maxMs);
    expect(gapLeft(Number.POSITIVE_INFINITY, 1_000_000, WINDOW)).toBe(0);
    expect(gapLeft(Number.NaN, 1_000_000, WINDOW)).toBe(0);
  });
});

describe("the pacer", () => {
  it("waits out exactly what is left, and no more", async () => {
    const { it, slept } = pacer(new Remembered(1_030_000));

    await it.pause();

    expect(slept).toEqual([30_000]);
  });

  it("does not sleep at all when the gap has already passed", async () => {
    // Which is the common case: somebody who reposts one ad, closes the popup and
    // comes back an hour later should meet no wait whatsoever.
    const { it, slept } = pacer(new Remembered(900_000));

    await it.pause();

    expect(slept).toEqual([]);
  });

  it("answers the same number it would wait, so a countdown is not a second draw", async () => {
    // The popup renders this and the worker sleeps it. Two draws would disagree,
    // and the row would either finish early or sit on a zero.
    const { it } = pacer(new Remembered(1_045_000));

    expect(await it.msBeforeNextRelist()).toBe(45_000);
  });

  it("sets the next deadline from when a relist starts", async () => {
    const memory = new Remembered();
    const { it } = pacer(memory, [0.25]);

    await it.startedRelisting();

    expect(memory.at).toBe(1_000_000 + 50_000);
  });

  it("draws a new gap each time rather than reusing one", async () => {
    const memory = new Remembered();
    const { it } = pacer(memory, [0, 1]);

    await it.startedRelisting();
    const first = memory.at;
    await it.startedRelisting();

    expect(first).toBe(1_040_000);
    expect(memory.at).toBe(1_080_000);
  });
});

describe("the built-in window", () => {
  it("starts above the rail the backend refuses on", () => {
    // `mprelist.safety.minimum-interval` is 30s. A gap that could come in under it
    // would hand the user the cooldown this exists to keep them away from — which
    // is the ticket's third criterion, and the reason the floor is not 30 exactly:
    // a request takes time and two clocks disagree.
    expect(HUMAN_PACE.minMs).toBeGreaterThan(30_000);
  });

  it("and stays well inside the life of an MV3 worker", () => {
    // Chrome allows one five minutes. The wait happens inside a message the popup
    // is holding open, so a window anywhere near that would be a relist killed
    // mid-sleep rather than a relist paced.
    expect(HUMAN_PACE.maxMs).toBeLessThanOrEqual(120_000);
  });
});

/**
 * The half a pacer alone cannot say anything about: *where* the wait happens.
 *
 * The events log is the same one the delete-first tests read, so these assert the
 * pace against the real sequence — authorize, save, delete, create — rather than
 * against a call count.
 */
function relisting(options: { gate?: (events: FakeEvent[]) => FakeRelistPermission } = {}) {
  const events: FakeEvent[] = [];
  const client = new FakeMarktplaatsClient(events, { ads: { "ad-1": sampleAd() } });
  const store = new InMemorySnapshotStore(events);
  // Everything logs into the one array — the gate included, which is what lets
  // these read the pace and the authorization as a single order.
  const gate = options.gate?.(events) ?? new FakeRelistPermission(undefined, events);
  const pace = new FakePace(events, 45_000);
  return { orchestrator: new RelistOrchestrator(client, store, gate, pace), store, events };
}

const kinds = (events: FakeEvent[]): string[] => events.map((event) => event.type);

describe("where the orchestrator waits", () => {
  it("waits before it asks for permission, not after", async () => {
    // The backend's rails count from the reservation `authorize` takes, so a gap
    // that ran after it would be measured against a clock already started — and a
    // request certain to be refused for arriving too soon should not be sent.
    const { orchestrator, events } = relisting();

    await orchestrator.relist("ad-1");

    expect(kinds(events).slice(0, 3)).toEqual(["pace", "authorize", "paced"]);
  });

  it("takes its turn only once a grant has been given", async () => {
    // A refused attempt reached Marktplaats not at all, so there is nothing to
    // space out — and spacing it would make the cooldown the user is already
    // being shown longer than the backend said it was.
    const { orchestrator, events } = relisting({
      gate: (log) => refusing({ state: "upgrade", resetAt: null }, log),
    });

    await orchestrator.relist("ad-1");

    expect(kinds(events)).toEqual(["pace", "authorize"]);
  });

  it("still waits before deleting anything", async () => {
    const { orchestrator, events } = relisting();

    await orchestrator.relist("ad-1");

    const paced = events.findIndex((event) => event.type === "pace");
    const deleted = events.findIndex((event) => event.type === "delete");
    expect(paced).toBeGreaterThanOrEqual(0);
    expect(paced).toBeLessThan(deleted);
  });

  it("does not make somebody wait to have their deleted ad put back", async () => {
    // A `deleted` snapshot is recovery: the ad is already gone, the create is all
    // that is left, and nothing is authorized. Pacing it would make the ADR-0003
    // snapshot slower to redeem than the failure it exists for.
    const { orchestrator, store, events } = relisting();
    await store.save({
      listingId: "ad-1",
      draft: sampleAd().draft,
      photos: sampleAd().photos,
      phase: "deleted",
      createdAt: Date.now(),
      grantJti: "grant-earlier",
    });
    events.length = 0;

    await orchestrator.retry("ad-1");

    expect(kinds(events)).not.toContain("pace");
    expect(kinds(events)).toContain("create");
  });

  it("but does wait to resume one that may still delete something", async () => {
    // A `captured` snapshot may not have got as far as the delete, so finishing it
    // is a relist like any other — it re-authorizes, and what re-authorizes is
    // paced.
    const { orchestrator, store, events } = relisting();
    await store.save({
      listingId: "ad-1",
      draft: sampleAd().draft,
      photos: sampleAd().photos,
      phase: "captured",
      createdAt: Date.now(),
      grantJti: "grant-earlier",
    });
    events.length = 0;

    await orchestrator.resumeAll();

    expect(kinds(events).slice(0, 3)).toEqual(["pace", "authorize", "paced"]);
  });
});
