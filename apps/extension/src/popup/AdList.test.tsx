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

function fakeWorker(outcome: WireRelistOutcome = { status: "relisted" }) {
  let release: ((value: WireRelistOutcome) => void) | null = null;
  const worker = {
    relist: vi.fn(
      (): Promise<WireRelistOutcome> =>
        pending ? new Promise((resolve) => (release = resolve)) : Promise.resolve(outcome),
    ),
    retry: vi.fn(async (): Promise<WireRelistOutcome> => outcome),
  } as unknown as WorkerPort;
  let pending = false;
  return {
    worker,
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

async function show(worker: WorkerPort, onRelisted: () => void = () => {}): Promise<void> {
  await act(async () => {
    root.render(<AdList view={{ status: "ready", ads: ADS }} worker={worker} onRelisted={onRelisted} />);
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

  it("says so on the row, and asks for a reload", async () => {
    // The list is stale the moment one of them is reposted — the ad has a new id
    // — and so is the quota above it.
    const reloaded = vi.fn();
    const { worker } = fakeWorker();

    await show(worker, reloaded);
    await press(0);

    expect(text()).toContain("Reposted. Reloading your ads…");
    expect(reloaded).toHaveBeenCalledTimes(1);
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

    await finish({ status: "relisted" });
    expect(worker.relist).toHaveBeenCalledTimes(1);
  });

  it("and lets go when it finishes", async () => {
    const { worker, hang, finish } = fakeWorker();
    hang();

    await show(worker);
    await press(0);
    await finish({ status: "failed-before-delete", error: WIRE_ERROR });

    expect(buttons()[1]?.disabled).toBe(false);
  });
});

describe("when it does not work", () => {
  it("says the ad is untouched, and offers to start over", async () => {
    const { worker } = fakeWorker({ status: "failed-before-delete", error: WIRE_ERROR });

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
    const { worker } = fakeWorker({ status: "failed-recoverable", listingId: "m1", error: WIRE_ERROR });

    await show(worker);
    await press(0);

    expect(text()).toContain("saved in the extension");
    expect(buttons()[0]?.textContent).toContain("Retry");

    await press(0);
    expect(worker.retry).toHaveBeenCalledWith("m1");
    expect(worker.relist).toHaveBeenCalledTimes(1);
  });

  it("does not ask for a reload when nothing was reposted", async () => {
    const reloaded = vi.fn();
    const { worker } = fakeWorker({ status: "failed-before-delete", error: WIRE_ERROR });

    await show(worker, reloaded);
    await press(0);

    expect(reloaded).not.toHaveBeenCalled();
  });

  it("survives a worker that does not answer at all", async () => {
    const worker = {
      relist: vi.fn(async () => {
        throw new Error("The extension's background worker did not answer.");
      }),
      retry: vi.fn(),
    } as unknown as WorkerPort;

    await show(worker);
    await press(0);

    expect(text()).toContain("Nothing was reposted.");
    expect(buttons()[1]?.disabled).toBe(false);
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
