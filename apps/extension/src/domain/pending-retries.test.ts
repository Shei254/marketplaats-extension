import { describe, expect, it } from "vitest";

import { PendingRetries, type RetryAlarm } from "./pending-retries";
import type { PendingRepost } from "./types";

/**
 * When a pending repost is tried again, and when it stops being (ADR-0039): a
 * few quick retries in the worker, then an alarm while a marktplaats.nl tab is
 * open, then nothing until a page load says one is open again.
 */

function pending(overrides: Partial<PendingRepost> = {}): PendingRepost {
  return { listingId: "ad-1", title: "Fiets", needsUser: false, running: false, ...overrides };
}

class FakeAlarm implements RetryAlarm {
  readonly scheduled: Array<{ delayMs: number; stage: number }> = [];
  cleared = 0;

  async schedule(delayMs: number, stage: number): Promise<void> {
    this.scheduled.push({ delayMs, stage });
  }

  async clear(): Promise<void> {
    this.cleared += 1;
  }
}

/**
 * @param leftAfter what is still pending after each resume, in order; the last
 *   entry repeats.
 */
function retrying(options: { leftAfter?: PendingRepost[][]; tabOpen?: boolean } = {}) {
  const leftAfter = options.leftAfter ?? [[pending()]];
  const alarm = new FakeAlarm();
  const waited: number[] = [];
  let resumes = 0;
  const retries = new PendingRetries({
    resume: async () => {
      resumes += 1;
    },
    pending: async () => leftAfter[Math.min(resumes, leftAfter.length) - 1] ?? leftAfter[0]!,
    alarm,
    marktplaatsOpen: async () => options.tabOpen ?? true,
    wait: async (ms) => {
      waited.push(ms);
    },
  });
  return { retries, alarm, waited, resumes: () => resumes };
}

describe("after a repost fails", () => {
  it("tries again at 2, 5 and 10 seconds, then leaves it to an alarm at 30", async () => {
    const { retries, alarm, waited, resumes } = retrying();

    await retries.afterFailure();

    expect(waited).toEqual([2_000, 5_000, 10_000]);
    expect(resumes()).toBe(3);
    expect(alarm.scheduled).toEqual([{ delayMs: 30_000, stage: 0 }]);
  });

  it("stops as soon as nothing is left to put back", async () => {
    const { retries, alarm, waited } = retrying({ leftAfter: [[pending()], []] });

    await retries.afterFailure();

    expect(waited).toEqual([2_000, 5_000]);
    expect(alarm.scheduled).toEqual([]);
    expect(alarm.cleared).toBe(1);
  });

  it("does not keep going for one that waits for the user", async () => {
    const { retries, alarm, waited } = retrying({ leftAfter: [[pending({ needsUser: true })]] });

    await retries.afterFailure();

    expect(waited).toEqual([2_000]);
    expect(alarm.scheduled).toEqual([]);
  });
});

describe("when the alarm goes off", () => {
  it("tries again and schedules the next, from 30 seconds to 2 minutes to every 5", async () => {
    const { retries, alarm, resumes } = retrying();

    await retries.onAlarm(0);
    await retries.onAlarm(1);
    await retries.onAlarm(2);

    expect(resumes()).toBe(3);
    expect(alarm.scheduled).toEqual([
      { delayMs: 120_000, stage: 1 },
      { delayMs: 300_000, stage: 2 },
      { delayMs: 300_000, stage: 2 },
    ]);
  });

  it("stops when it has put everything back", async () => {
    const { retries, alarm } = retrying({ leftAfter: [[]] });

    await retries.onAlarm(1);

    expect(alarm.scheduled).toEqual([]);
    expect(alarm.cleared).toBe(1);
  });

  it("does nothing without a marktplaats.nl tab, and waits for one to open", async () => {
    const { retries, alarm, resumes } = retrying({ tabOpen: false });

    await retries.onAlarm(1);

    expect(resumes()).toBe(0);
    expect(alarm.scheduled).toEqual([]);
    expect(alarm.cleared).toBe(1);
  });
});

describe("when a marktplaats.nl page loads", () => {
  it("tries straight away, and hands anything left to the alarm", async () => {
    const { retries, alarm, waited, resumes } = retrying();

    await retries.onReady();

    expect(waited).toEqual([]);
    expect(resumes()).toBe(1);
    expect(alarm.scheduled).toEqual([{ delayMs: 30_000, stage: 0 }]);
  });

  it("costs nothing more when there is nothing pending", async () => {
    const { retries, alarm } = retrying({ leftAfter: [[]] });

    await retries.onReady();

    expect(alarm.scheduled).toEqual([]);
  });
});

describe("two failures at once", () => {
  it("share one round of quick retries", async () => {
    const { retries, waited } = retrying();

    await Promise.all([retries.afterFailure(), retries.afterFailure()]);

    expect(waited).toEqual([2_000, 5_000, 10_000]);
  });
});
