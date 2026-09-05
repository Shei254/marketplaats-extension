import type { BatchAlarms } from "../background/batch-runner";

/**
 * The real {@link BatchAlarms}: one named `chrome.alarms` alarm that advances a
 * batch (T68, #147; ADR-0025).
 *
 * **An alarm rather than a timer, because the worker will not be there.** An MV3
 * service worker is torn down about thirty seconds after it goes idle and the gap
 * between two ads in a run is thirty to sixty — so a `setTimeout` is a run that
 * stops at the first gap and looks, from outside, exactly like one that finished.
 * The alarm is what wakes the worker back up, and it survives the popup closing,
 * the worker being evicted, and the browser being restarted.
 *
 * **That last one is why the runner drops a run on startup.** Alarms persisting
 * across sessions is a property of the mechanism, not a decision, and the decision
 * ADR-0025 took on top of it is the opposite: delete-first must not fire at ads
 * nobody has thought about since yesterday.
 *
 * **MV3 clamps this at about thirty seconds**, which is where `BULK_PACE`'s floor
 * comes from — and unpacked builds are *not* clamped, so a shorter window works
 * locally and becomes a metronome for everybody else.
 *
 * One alarm and one name: a run has exactly one next ad, so a second alarm could
 * only ever mean two wakes for one step. `create` with the same name replaces
 * whatever was pending, which is what makes {@link at} idempotent.
 */
const ALARM = "mprelist-batch";

export class ChromeBatchAlarm implements BatchAlarms {
  async at(when: number): Promise<void> {
    chrome.alarms.create(ALARM, { when });
  }

  async cancel(): Promise<void> {
    await chrome.alarms.clear(ALARM);
  }

  async pending(): Promise<boolean> {
    return (await chrome.alarms.get(ALARM)) !== undefined;
  }
}

/** True when this is the alarm a batch is advanced by, and not somebody else's. */
export function isBatchAlarm(alarm: chrome.alarms.Alarm): boolean {
  return alarm.name === ALARM;
}
