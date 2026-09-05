import type { BatchRun } from "./batch-run";

/**
 * Where a run is kept between two ads (T68, #147).
 *
 * A port for {@link SnapshotStore}'s reason and one sharper. It **has** to
 * outlive the thing that started it: a Chrome popup is destroyed by any click
 * outside it and an MV3 worker is torn down about thirty seconds after it goes
 * idle, so a queue held in either is a queue that ends when somebody looks at
 * something else — mid-relist, with delete-first half executed. That is the whole
 * argument ADR-0025 makes for the worker owning this, and it is only true if the
 * run is written down.
 *
 * The real one is `chrome-batch-store.ts`. The seam is what lets `batch-runner.ts`
 * be tested a whole run at a time with no browser in the way.
 */
export interface BatchStore {
  /** The run, or nothing — including when what is stored is not one this build wrote. */
  read(): Promise<BatchRun | null>;
  write(run: BatchRun): Promise<void>;
  /** Forget it entirely, which is what a user dismissing a finished run does. */
  clear(): Promise<void>;
}
