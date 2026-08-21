// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WireRelistOutcome } from "../background/messages";
import type { ListingSummary } from "../domain/types";
import { AdList } from "./AdList";
import type { WorkerPort } from "./screen";

/**
 * The row machine (T30b, #79), driven the way a user drives it: clicked in a real
 * document and read back.
 *
 * The one that matters most is the lock. A distracted click on three rows is
 * three ads deleted before the first has been posted again, and delete-first
 * (ADR-0003) makes that irreversible — so "the other buttons stop working while
 * one is running" is asserted as a property of the DOM rather than of the state.
 */
const ADS: ListingSummary[] = [
  { id: "m1", title: "Vintage Eames lounge chair", priceCents: 125_000 },
  { id: "m2", title: "Trek Marlin 7 mountainbike (M)", priceCents: 48_000 },
];

const WIRE_ERROR = { code: "NO_MARKTPLAATS_TAB", message: "No marktplaats.nl tab is open" } as const;

const QUOTA = { quotaRemaining: 1, resetAt: "2026-09-14T08:31:22.101Z" };
const RELISTED: WireRelistOutcome = { status: "relisted", quota: QUOTA };

function fakeWorker(outcome: WireRelistOutcome = RELISTED) {
  let release: ((value: WireRelistOutcome) => void) | null = null;
  const worker = {
    relist: vi.fn(
      (): Promise<WireRelistOutcome> =>
        pending ? new Promise((resolve) => (release = resolve)) : Promise.resolve(outcome),
    ),
    retry: vi.fn(async (): Promise<WireRelistOutcome> => outcome),
    msBeforeNextRelist: vi.fn(async () => waitMs),
  } as unknown as WorkerPort;
  let pending = false;
  let waitMs = 0;
  return {
    worker,
    /** Make the worker say it will pace this one, so the countdown can be looked at. */
    pacing: (ms: number) => {
      waitMs = ms;
    },
    /** Make the next relist hang, so the busy state can be looked at. */
    hang: () => {
      pending = true;
    },
    finish: async (answer: WireRelistOutcome) => {
      await act(async () => release?.(answer));
    },
  };
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function show(
  worker: WorkerPort,
  onOutcome: (outcome: WireRelistOutcome) => void = () => {},
): Promise<void> {
  await act(async () => {
    root.render(<AdList view={{ status: "ready", ads: ADS }} worker={worker} onOutcome={onOutcome} />);
  });
}

const rows = (): HTMLLIElement[] => [...container.querySelectorAll("li")];
const buttons = (): HTMLButtonElement[] => [...container.querySelectorAll("button")];
const text = (): string => container.textContent ?? "";

async function press(index: number): Promise<void> {
  const button = buttons()[index];
  if (!button) throw new Error("no such row");
  await act(async () => {
    button.click();
  });
}

describe("reposting one ad", () => {
  it("asks the worker for that ad, and nothing else", async () => {
    const { worker } = fakeWorker();

    await show(worker);
    await press(0);

    expect(worker.relist).toHaveBeenCalledWith("m1");
    expect(worker.retry).not.toHaveBeenCalled();
  });

  it("says so on the row, and hands the outcome up with the fresh quota on it", async () => {
    // The screen above owns the plan strip and the list, and both moved: the ad
    // has a new id, and `/complete` already said what the period has left (#41).
    const outcomes: WireRelistOutcome[] = [];
    const { worker } = fakeWorker();

    await show(worker, (outcome) => outcomes.push(outcome));
    await press(0);

    expect(text()).toContain("Reposted. Reloading your ads…");
    expect(outcomes).toEqual([RELISTED]);
  });
});

describe("one relist at a time", () => {
  it("locks every other row while one is running", async () => {
    const { worker, hang, finish } = fakeWorker();
    hang();

    await show(worker);
    await press(0);

    expect(text()).toContain("Reposting…");
    expect(buttons()[1]?.disabled).toBe(true);
    // And the running one cannot be pressed twice either.
    expect(buttons()[0]?.disabled).toBe(true);

    await finish(RELISTED);
    expect(worker.relist).toHaveBeenCalledTimes(1);
  });

  it("and lets go when it finishes", async () => {
    const { worker, hang, finish } = fakeWorker();
    hang();

    await show(worker);
    await press(0);
    await finish({ status: "failed-before-delete", error: WIRE_ERROR, quota: QUOTA });

    expect(buttons()[1]?.disabled).toBe(false);
  });
});

describe("when it does not work", () => {
  it("says the ad is untouched, and offers to start over", async () => {
    const { worker } = fakeWorker({ status: "failed-before-delete", error: WIRE_ERROR, quota: QUOTA });

    await show(worker);
    await press(0);

    expect(text()).toContain("your ad is untouched");
    expect(buttons()[0]?.textContent).toContain("Try again");

    await press(0);
    expect(worker.relist).toHaveBeenCalledTimes(2);
  });

  it("says where the ad went, and retries from the snapshot rather than starting over", async () => {
    // This row's ad is already deleted. Pressing the button must resume the
    // snapshot, not start a fresh relist — one puts the ad back, the other would
    // authorize and delete again.
    const { worker } = fakeWorker({ status: "failed-recoverable", listingId: "m1", error: WIRE_ERROR, quota: QUOTA });

    await show(worker);
    await press(0);

    expect(text()).toContain("saved in the extension");
    expect(buttons()[0]?.textContent).toContain("Retry");

    await press(0);
    expect(worker.retry).toHaveBeenCalledWith("m1");
    expect(worker.relist).toHaveBeenCalledTimes(1);
  });

  it("still hands a failure up, because the refunded quota is news too", async () => {
    // `FAILED_BEFORE_DELETE` gives the unit back, so the strip has moved even
    // though the ad has not. What is *not* done here is reloading the list —
    // that decision belongs to the screen above, and it has the outcome.
    const outcomes: WireRelistOutcome[] = [];
    const { worker } = fakeWorker({ status: "failed-before-delete", error: WIRE_ERROR, quota: QUOTA });

    await show(worker, (outcome) => outcomes.push(outcome));
    await press(0);

    expect(outcomes[0]).toMatchObject({ status: "failed-before-delete", quota: QUOTA });
  });

  it("survives a worker that does not answer at all", async () => {
    const worker = {
      relist: vi.fn(async () => {
        throw new Error("The extension's background worker did not answer.");
      }),
      retry: vi.fn(),
      // A worker that is not there cannot say how long it would pace either. The
      // row still has to start and still has to end up saying what happened.
      msBeforeNextRelist: vi.fn(async () => {
        throw new Error("The extension's background worker did not answer.");
      }),
    } as unknown as WorkerPort;

    await show(worker);
    await press(0);

    expect(text()).toContain("Nothing was reposted.");
    expect(buttons()[1]?.disabled).toBe(false);
  });
});

describe("a cooldown", () => {
  it("counts down on the row, and locks every other one", async () => {
    // The pacing rails are per user (ADR-0008), so the next ad would be refused
    // for the same reason — a button that offered to try is a button that lies.
    vi.useFakeTimers();
    const { worker } = fakeWorker({ status: "refused", locked: { state: "cooldown", retryAfter: 3 } });

    await show(worker);
    await press(0);

    expect(buttons()[0]?.textContent).toContain("3s");
    expect(buttons()[1]?.disabled).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(buttons()[0]?.textContent).toContain("2s");

    vi.useRealTimers();
  });

  it("gives the buttons back when it runs out, without anybody asking", async () => {
    // A countdown that stopped at zero and stayed locked would be a cooldown the
    // user has to guess the end of, which is the failure it exists to prevent.
    vi.useFakeTimers();
    const { worker } = fakeWorker({ status: "refused", locked: { state: "cooldown", retryAfter: 2 } });

    await show(worker);
    await press(0);
    expect(buttons()[1]?.disabled).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(buttons()[1]?.disabled).toBe(false);
    expect(buttons()[1]?.textContent).toContain("Repost");

    vi.useRealTimers();
  });

  it("locks nothing when the refusal named no seconds", async () => {
    // Without a number there is nothing to count, and locking the list for an
    // unknown time is worse than letting the next attempt be refused too.
    const { worker } = fakeWorker({
      status: "refused",
      locked: { state: "cooldown", retryAfter: null },
    });

    await show(worker);
    await press(0);

    expect(buttons()[1]?.disabled).toBe(false);
  });
});

describe("a wait the extension chose", () => {
  /**
   * T46 (#54). The worker paces a relist before it starts; what this list has to
   * do is make that legible — a button reading "Reposting…" for a minute is the
   * shape of a hang, and the ticket's fourth criterion is that a user can tell the
   * two apart.
   */
  it("counts the wait down on the row that is waiting", async () => {
    vi.useFakeTimers();
    const { worker, pacing, hang } = fakeWorker();
    pacing(45_000);
    hang();

    await show(worker);
    await press(0);

    expect(buttons()[0]?.textContent).toContain("45s");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(buttons()[0]?.textContent).toContain("44s");

    vi.useRealTimers();
  });

  it("and says why it is waiting, in the user's own interest", async () => {
    // The reason is theirs: ADR-0008 paces relists because a run of them arriving
    // as fast as a worker can loop is machine-shaped against *their* Marktplaats
    // account, which is the one that gets flagged.
    const { worker, pacing, hang } = fakeWorker();
    pacing(45_000);
    hang();

    await show(worker);
    await press(0);

    expect(text()).toContain("look like clicks rather than a script");
  });

  it("leaves every other row locked while it waits", async () => {
    // The relist is already in flight from the list's point of view — one at a
    // time is #79's rule and a wait does not suspend it.
    const { worker, pacing, hang } = fakeWorker();
    pacing(45_000);
    hang();

    await show(worker);
    await press(0);

    expect(buttons()[1]?.disabled).toBe(true);
  });

  it("says Reposting… once the wait is over, without being asked again", async () => {
    vi.useFakeTimers();
    const { worker, pacing, hang } = fakeWorker();
    pacing(2_000);
    hang();

    await show(worker);
    await press(0);
    expect(buttons()[0]?.textContent).toContain("2s");

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(buttons()[0]?.textContent).toContain("Reposting");
    expect(text()).not.toContain("look like clicks");

    vi.useRealTimers();
  });

  it("draws no countdown when there is no wait to draw", async () => {
    // The common case, and the first relist of any session: enough time has
    // passed, the worker sleeps for nothing, and the row goes straight to work.
    const { worker, hang } = fakeWorker();
    hang();

    await show(worker);
    await press(0);

    expect(buttons()[0]?.textContent).toContain("Reposting");
    expect(text()).not.toContain("look like clicks");
  });

  it("does not hand its countdown to the relist after it", async () => {
    // The clock has to be put away when the attempt ends, not left to run out on
    // its own: an answer that arrives before the wait does — a worker that died,
    // a refusal — would otherwise leave a deadline ticking, and the *next* row
    // pressed would inherit a countdown for a wait nobody is waiting.
    vi.useFakeTimers();
    const { worker, pacing, hang } = fakeWorker({ status: "refused", locked: { state: "upgrade", resetAt: null } });
    pacing(45_000);

    await show(worker);
    await press(0);

    pacing(0);
    hang();
    await press(1);

    expect(buttons()[1]?.textContent).toContain("Reposting");

    vi.useRealTimers();
  });

  it("stops counting the moment the attempt is over", async () => {
    // A worker that answered early — one that could not pace at all, or refused —
    // must not leave a clock ticking on a row that has finished.
    const { worker, pacing } = fakeWorker({ status: "refused", locked: { state: "upgrade", resetAt: null } });
    pacing(45_000);

    await show(worker);
    await press(0);

    expect(text()).not.toContain("look like clicks");
    expect(text()).toContain("used your relists");
  });
});

describe("when the backend refuses", () => {
  it("locks the row and says why, without pretending something broke", async () => {
    const { worker } = fakeWorker({ status: "refused", locked: { state: "upgrade", resetAt: null } });

    await show(worker);
    await press(0);

    expect(text()).toContain("used your relists");
    expect(buttons()[0]?.disabled).toBe(true);
  });

  it("counts a cooldown in the seconds it was given", async () => {
    const { worker } = fakeWorker({ status: "refused", locked: { state: "cooldown", retryAfter: 24 } });

    await show(worker);
    await press(0);

    expect(text()).toContain("24s");
  });

  it("leaves the other rows alone, since nothing is running", async () => {
    const { worker } = fakeWorker({ status: "refused", locked: { state: "upgrade", resetAt: null } });

    await show(worker);
    await press(0);

    expect(buttons()[1]?.disabled).toBe(false);
  });
});
