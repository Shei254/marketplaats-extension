import type { PendingRepost } from "./types";

/**
 * The alarm that carries retries past the worker's lifetime. `stage` rides with
 * it because the worker that schedules one is rarely the worker that wakes to
 * it, and the next delay depends on how many came before.
 */
export interface RetryAlarm {
  schedule(delayMs: number, stage: number): Promise<void>;
  clear(): Promise<void>;
}

export interface PendingRetriesDeps {
  /** Finish what can be finished — `RelistOrchestrator.resumeAll`. */
  resume(): Promise<unknown>;
  /** What is still pending afterwards — `RelistOrchestrator.pendingReposts`. */
  pending(): Promise<PendingRepost[]>;
  alarm: RetryAlarm;
  /** Whether a marktplaats.nl tab is open, without which no retry can reach Marktplaats. */
  marktplaatsOpen(): Promise<boolean>;
  wait?: (ms: number) => Promise<void>;
}

/** In the worker, straight after a failure: it is awake anyway, and most failures are a blip. */
const QUICK_MS = [2_000, 5_000, 10_000];

/** Then by alarm, the last delay repeating for as long as something is pending (no cap). */
const ALARM_MS = [30_000, 120_000, 300_000];

/**
 * When a **Pending repost** is tried again, in layers (ADR-0039): quick retries
 * while the worker is awake, then an alarm while a marktplaats.nl tab is open,
 * then nothing until a page load says one is open again. A repost that waits for
 * the user (`needsUser`) is never what keeps this going.
 */
export class PendingRetries {
  private readonly wait: (ms: number) => Promise<void>;

  constructor(private readonly deps: PendingRetriesDeps) {
    this.wait = deps.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** The round of quick retries in progress, which a second failure joins. */
  private quick: Promise<void> | null = null;

  /** A repost just failed and left something pending. */
  afterFailure(): Promise<void> {
    this.quick ??= this.quickRetries().finally(() => (this.quick = null));
    return this.quick;
  }

  /**
   * A marktplaats.nl page loaded — the one moment a retry is certain to reach a
   * live tab, which is why this, and not browser start or install, is when a
   * resume runs.
   */
  async onReady(): Promise<void> {
    await this.deps.resume();
    if (await this.anyRetryable()) await this.deps.alarm.schedule(ALARM_MS[0]!, 0);
  }

  private async quickRetries(): Promise<void> {
    for (const ms of QUICK_MS) {
      await this.wait(ms);
      await this.deps.resume();
      if (!(await this.anyRetryable())) {
        await this.deps.alarm.clear();
        return;
      }
    }
    await this.deps.alarm.schedule(ALARM_MS[0]!, 0);
  }

  /**
   * An alarm fired. Without a marktplaats.nl tab there is nothing a retry could
   * reach, so the alarm is dropped rather than rescheduled — the next page load's
   * `onReady` picks it up.
   */
  async onAlarm(stage: number): Promise<void> {
    if (!(await this.deps.marktplaatsOpen())) {
      await this.deps.alarm.clear();
      return;
    }
    await this.deps.resume();
    if (!(await this.anyRetryable())) {
      await this.deps.alarm.clear();
      return;
    }
    const next = Math.min(stage + 1, ALARM_MS.length - 1);
    await this.deps.alarm.schedule(ALARM_MS[next]!, next);
  }

  /** Something left that a retry could finish: not waiting for the user, not already running. */
  private async anyRetryable(): Promise<boolean> {
    return (await this.deps.pending()).some((repost) => !repost.needsUser && !repost.running);
  }
}
