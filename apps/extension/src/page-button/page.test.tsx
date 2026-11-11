// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WireRelistOutcome } from "../background/messages";
import type { PendingRepost } from "../domain/types";
import { AD_UNCHANGED, UNCONFIRMED, refusalNote } from "../popup/relisting";
import { findSlots } from "./anchors";
import { PageButtonsOnPage } from "./page";
import { NEEDS_YOU, PUTTING_BACK, SETTLED_UNSEEN, type PagePort } from "./PageButtons";
import { rowHtml } from "./testing/row";

/**
 * The **Page button** on a Mijn Advertenties built from the real row markup
 * (ADR-0040), driven the way a seller drives it: clicked and read back. The
 * shadow roots are opened here the way a test can and the page cannot.
 */
const PLANS_URL = "https://www.example.test/#abonnementen";
const RELISTED: WireRelistOutcome = { status: "relisted", quota: null };
const PARKED: WireRelistOutcome = { status: "unconfirmed", listingId: "m1", reason: "unknown" };

/** A snapshot the worker is holding for the first row. */
const pending = (overrides: Partial<PendingRepost> = {}): PendingRepost => ({
  listingId: "m1", title: "Vintage stoel", needsUser: false, running: false, deleted: true, replaced: false, ...overrides,
});

function fakeWorker(outcome: WireRelistOutcome = RELISTED) {
  let release: ((value: WireRelistOutcome) => void) | null = null;
  let hang = false;
  const worker = {
    retry: vi.fn(async (): Promise<WireRelistOutcome> => RELISTED),
    /** What the worker is holding a snapshot of; set by each test. */
    pendingReposts: vi.fn(async (): Promise<PendingRepost[]> => []),
    relist: vi.fn((): Promise<WireRelistOutcome> =>
      hang ? new Promise((resolve) => (release = resolve)) : Promise.resolve(outcome),
    ),
    msBeforeNextRelist: vi.fn(async () => 0),
    relistStatus: vi.fn(async (): Promise<string | null> => null),
    portal: vi.fn(async () => ({ status: "opened" as const, url: "https://billing.example" })),
  };
  return {
    worker: worker as unknown as PagePort & typeof worker,
    hang: () => {
      hang = true;
    },
    finish: async (answer: WireRelistOutcome) => {
      await act(async () => release?.(answer));
    },
  };
}

let page: PageButtonsOnPage | null = null;
const refresh = vi.fn();

beforeEach(() => {
  (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
  document.body.innerHTML = rowHtml("m1", "Vintage stoel") + rowHtml("m2", "Trek fiets");
  refresh.mockReset();
});

afterEach(async () => {
  await act(async () => page?.stop());
  page = null;
  document.body.innerHTML = "";
});

async function open(worker: PagePort, grantsNothing = false): Promise<void> {
  page = new PageButtonsOnPage({
    doc: document,
    worker,
    findSlots,
    plansUrl: PLANS_URL,
    render: (element) => {
      const root = createRoot(element);
      return { render: (tree) => root.render(tree), unmount: () => root.unmount() };
    },
    refresh,
  });
  await act(async () => page?.start(grantsNothing));
}

const hosts = (variant: "button" | "link") =>
  [...document.querySelectorAll<HTMLElement>(`[data-adbump-page-button][data-variant="${variant}"]`)];
const button = (index: number, variant: "button" | "link" = "button"): HTMLButtonElement => {
  const found = hosts(variant)[index]?.shadowRoot?.querySelector("button");
  if (!found) throw new Error(`no ${variant} ${index}`);
  return found;
};
const overlay = (): ShadowRoot => {
  const host = document.querySelector<HTMLElement>("[data-adbump-page-button]:not([data-variant])");
  if (!host?.shadowRoot) throw new Error("no overlay");
  return host.shadowRoot;
};
const card = () => overlay().querySelector(".pb-card");
const toast = () => overlay().querySelector(".pb-toast");

async function press(target: HTMLElement): Promise<void> {
  await act(async () => target.click());
}

describe("where it is drawn", () => {
  it("puts Herplaats above each Sneller verkopen, and a compact one beside the narrow link", async () => {
    const { worker } = fakeWorker();
    await open(worker);

    expect(hosts("button")).toHaveLength(2);
    expect(hosts("link")).toHaveLength(2);
    const [host] = hosts("button");
    expect(host?.nextElementSibling?.classList.contains("AdFeatures-module-cta")).toBe(true);
    expect(hosts("link")[0]?.nextElementSibling?.classList.contains("SellerAdRow-module-sellFasterMobile")).toBe(true);
    expect(button(0).textContent).toBe("Herplaats");
    expect(button(0).title).toContain("Vintage stoel");
  });

  it("draws a row Marktplaats adds later, and takes everything away when stopped", async () => {
    const { worker } = fakeWorker();
    await open(worker);

    document.body.insertAdjacentHTML("beforeend", rowHtml("m3"));
    await act(async () => page?.scanNow());
    expect(hosts("button")).toHaveLength(3);

    await act(async () => page?.stop());
    expect(document.querySelectorAll("[data-adbump-page-button]")).toHaveLength(0);
  });
});

describe("reposting from the page", () => {
  it("reposts that ad, fades its row, and offers a refresh rather than reloading", async () => {
    const { worker } = fakeWorker();
    await open(worker);

    await press(button(0));

    expect(worker.relist).toHaveBeenCalledWith("m1");
    expect(button(0).textContent).toBe("Herplaatst");
    expect(button(0).disabled).toBe(true);
    expect(document.querySelector<HTMLElement>(".cells")?.style.opacity).toBe("0.5");
    expect(refresh).not.toHaveBeenCalled();

    const vernieuwen = [...(toast()?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Vernieuwen");
    await press(vernieuwen!);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("locks every other button while one is running", async () => {
    const { worker, hang, finish } = fakeWorker();
    hang();
    await open(worker);

    await press(button(0));
    expect(button(0).textContent).toBe("Herplaatsen…");
    expect(button(1).disabled).toBe(true);

    await finish(RELISTED);
    expect(button(1).disabled).toBe(false);
  });

  it("locks the page while the popup holds the worker's slot", async () => {
    const { worker } = fakeWorker();
    worker.relistStatus.mockResolvedValueOnce("m2");
    await open(worker);

    expect(button(0).disabled).toBe(true);
    expect(button(1).textContent).toBe("Herplaatsen…");
  });
});

describe("when a repost is refused", () => {
  it("opens a card with the popup's sentence and a way to the plans", async () => {
    const locked = { state: "upgrade", resetAt: "2026-12-01T00:00:00Z" } as const;
    const { worker } = fakeWorker({ status: "refused", locked });
    await open(worker);

    await press(button(0));

    expect(card()?.textContent).toContain(refusalNote(locked, false));
    const link = card()?.querySelector("a");
    expect(link?.textContent).toBe("Bekijk abonnementen");
    expect(link?.getAttribute("href")).toBe(PLANS_URL);
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("sends a failing card to the Portal", async () => {
    const { worker } = fakeWorker({ status: "refused", locked: { state: "update-card" } });
    await open(worker);

    await press(button(0));
    const action = [...(card()?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Betaling bijwerken");
    await press(action!);

    expect(worker.portal).toHaveBeenCalledOnce();
    expect(card()).toBeNull();
  });

  it("counts a cooldown down on the buttons, with no card", async () => {
    const { worker } = fakeWorker({ status: "refused", locked: { state: "cooldown", retryAfter: 30 } });
    await open(worker);

    await press(button(0));

    expect(card()).toBeNull();
    expect(button(1).textContent).toBe("Over 30s");
    expect(button(1).disabled).toBe(true);
  });

  it("draws a plan that grants nothing locked, and says why on a click instead of reposting", async () => {
    const { worker } = fakeWorker();
    await open(worker, true);

    expect(button(0).getAttribute("data-tone")).toBe("locked");
    await press(button(0));

    expect(worker.relist).not.toHaveBeenCalled();
    expect(card()?.textContent).toContain("Dit abonnement bevat geen herplaatsingen.");
  });
});

describe("when a repost fails after the delete", () => {
  const FAILED_AFTER_DELETE: WireRelistOutcome = {
    status: "failed-recoverable",
    listingId: "m1",
    error: { code: "NO_MARKTPLAATS_TAB", message: "No marktplaats.nl tab is open" },
    quota: null,
  };

  it("says it is being put back, offers Opnieuw, and leaves letting it go to the popup", async () => {
    const { worker } = fakeWorker(FAILED_AFTER_DELETE);
    worker.pendingReposts.mockResolvedValue([pending()]);
    await open(worker);

    await press(button(0));

    expect(button(0).textContent).toBe("Wordt teruggezet");
    expect(card()?.textContent).toContain(PUTTING_BACK);
    expect(card()?.textContent).not.toContain("Niet terugzetten");
    expect(card()?.querySelector(".pb-action")?.textContent).toBe("Opnieuw");
  });

  it("puts the ad back from the snapshot on Opnieuw, rather than reposting it again", async () => {
    const { worker } = fakeWorker(FAILED_AFTER_DELETE);
    worker.pendingReposts.mockResolvedValue([pending()]);
    await open(worker);
    await press(button(0));

    await press(card()!.querySelector<HTMLElement>(".pb-action")!);

    expect(worker.retry).toHaveBeenCalledWith("m1");
    expect(worker.relist).toHaveBeenCalledOnce();
    expect(button(0).textContent).toBe("Herplaatst");
  });
});

/**
 * **A repost the background settles later** (`unconfirmed`). The page asks the
 * worker what it is still holding every few seconds while a row waits, and the
 * row follows: put back is Herplaatst, cancelled is Herplaats again, and one the
 * background gave up on offers Opnieuw. Letting it go stays in the popup.
 */
describe("a repost the extension is still checking", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  async function parked(worker: ReturnType<typeof fakeWorker>["worker"]): Promise<void> {
    await open(worker);
    await press(button(0));
    expect(button(0).textContent).toBe("Wordt gecontroleerd…");
  }
  /** The first check is straight away; every one after waits five seconds. */
  const now = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
  const later = () => act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));

  it("asks straight away, before the background's first retry can settle it unseen", async () => {
    const { worker } = fakeWorker(PARKED);
    await parked(worker);

    await now();

    expect(worker.pendingReposts).toHaveBeenCalledOnce();
  });

  it("turns into Herplaatst once the background has put the ad back", async () => {
    const { worker } = fakeWorker(PARKED);
    worker.pendingReposts.mockResolvedValueOnce([pending()]).mockResolvedValue([]);
    await parked(worker);

    await now();
    expect(button(0).textContent).toBe("Wordt gecontroleerd…");
    await later();

    expect(button(0).textContent).toBe("Herplaatst");
    expect(document.querySelector<HTMLElement>(".cells")?.style.opacity).toBe("0.5");
    expect(toast()).not.toBeNull();
  });

  /**
   * A create-first repost that was unconfirmed is settled by being finished *or*
   * cancelled (ADR-0041), and the page cannot tell which — so it claims neither,
   * and in neither case is the ad gone.
   */
  it("is Herplaats again, and claims no outcome, when an unconfirmed create settles", async () => {
    const { worker } = fakeWorker(PARKED);
    worker.pendingReposts.mockResolvedValueOnce([pending({ deleted: false })]).mockResolvedValue([]);
    await parked(worker);

    await now();
    await later();

    expect(button(0).textContent).toBe("Herplaats");
    expect(button(0).disabled).toBe(false);
    expect(card()?.textContent).toContain(SETTLED_UNSEEN);
    expect(card()?.textContent).not.toContain(AD_UNCHANGED);
    expect(toast()).toBeNull();
  });

  it("is Herplaatst once the old ad a confirmed create replaced has gone", async () => {
    const { worker } = fakeWorker(PARKED);
    worker.pendingReposts
      .mockResolvedValueOnce([pending({ deleted: false, replaced: true })])
      .mockResolvedValue([]);
    await parked(worker);

    await now();
    await later();

    expect(button(0).textContent).toBe("Herplaatst");
    expect(toast()).not.toBeNull();
  });

  it("offers Opnieuw once the background has given up, and puts it back from there", async () => {
    const { worker } = fakeWorker(PARKED);
    worker.pendingReposts.mockResolvedValue([pending({ needsUser: true })]);
    await parked(worker);

    await now();

    expect(button(0).textContent).toBe("Opnieuw");
    expect(card()?.textContent).toContain(NEEDS_YOU);
    expect(card()?.textContent).not.toContain(UNCONFIRMED);

    await press(card()!.querySelector<HTMLElement>(".pb-action")!);

    expect(worker.retry).toHaveBeenCalledWith("m1");
    expect(button(0).textContent).toBe("Herplaatst");
  });

  it("claims neither outcome for a repost it never saw pending", async () => {
    const { worker } = fakeWorker(PARKED);
    worker.pendingReposts.mockResolvedValue([]);
    await parked(worker);

    await now();

    expect(button(0).textContent).toBe("Herplaats");
    expect(card()?.textContent).toContain(SETTLED_UNSEEN);
    expect(toast()).toBeNull();
  });

  it("stops asking once nothing on the page is waiting", async () => {
    const { worker } = fakeWorker(PARKED);
    worker.pendingReposts.mockResolvedValue([]);
    await parked(worker);
    await now();
    const asked = worker.pendingReposts.mock.calls.length;

    await later();
    await later();

    expect(worker.pendingReposts.mock.calls.length).toBe(asked);
  });
});
