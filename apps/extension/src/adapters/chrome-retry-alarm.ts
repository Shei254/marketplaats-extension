import type { RetryAlarm } from "../domain/pending-retries";

/**
 * The real {@link RetryAlarm}: one `chrome.alarms` alarm whose name carries the
 * stage, because the worker that wakes to it has no memory of the one that set it
 * (ADR-0039). Never more than one — scheduling clears whatever was there.
 */
const PREFIX = "pending-repost:";

export class ChromeRetryAlarm implements RetryAlarm {
  async schedule(delayMs: number, stage: number): Promise<void> {
    await this.clear();
    await chrome.alarms.create(`${PREFIX}${stage}`, { when: Date.now() + delayMs });
  }

  async clear(): Promise<void> {
    const alarms = await chrome.alarms.getAll();
    await Promise.all(
      alarms.filter((alarm) => alarm.name.startsWith(PREFIX)).map((alarm) => chrome.alarms.clear(alarm.name)),
    );
  }
}

/** The stage an alarm of ours carries, or `null` for an alarm that is not ours. */
export function retryStage(alarmName: string): number | null {
  if (!alarmName.startsWith(PREFIX)) return null;
  const stage = Number(alarmName.slice(PREFIX.length));
  return Number.isInteger(stage) ? stage : null;
}
