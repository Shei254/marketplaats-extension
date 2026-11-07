// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WireRelistOutcome } from "../background/messages";
import type { ListingSummary } from "../domain/types";
import type { AdPage } from "./ad-pages";
import type { AdsView } from "./ads";
import { AdList, LEAVING_MS } from "./AdList";
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
  { id: "m1", title: "Vintage Eames lounge chair", priceCents: 125_000, priceType: "FIXED", biddingEnabled: false, reserved: false },
  { id: "m2", title: "Trek Marlin 7 mountainbike (M)", priceCents: 48_000, priceType: "FIXED", biddingEnabled: false, reserved: false },
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
  /**
   * The plan the list is drawn under, as the one fact it is given about it: the
   * grant. The default is a plan that grants something, which is every test
   * written before T32 (#41).
   */
  plan: { grantsNothing?: boolean } = {},
): Promise<void> {
  await act(async () => {
    root.render(
      <AdList
        view={{ status: "ready", ads: ADS, total: ADS.length }}
        worker={worker}
        onOutcome={onOutcome}
        grantsNothing={plan.grantsNothing ?? false}
      />,
    );
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

    expect(buttons()[0]?.textContent).toBe("Herplaatst");
    expect(text()).not.toContain("opnieuw geladen");
    expect(outcomes).toEqual([RELISTED]);
  });
});

describe("one relist at a time", () => {
  it("locks every other row while one is running", async () => {
    const { worker, hang, finish } = fakeWorker();
    hang();

    await show(worker);
    await press(0);

    expect(text()).toContain("Bezig met herplaatsen…");
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

    expect(text()).toContain("je advertentie is ongewijzigd");
    expect(buttons()[0]?.textContent).toContain("Opnieuw proberen");

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

    expect(text()).toContain("opgeslagen in de extensie");
    expect(buttons()[0]?.textContent).toContain("Opnieuw");

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
    expect(buttons()[1]?.textContent).toContain("Herplaats");

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
   * do is make that legible — a button reading "Bezig met herplaatsen…" for a minute is the
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

    expect(text()).toContain("op klikken lijken en niet op een script");
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

    expect(buttons()[0]?.textContent).toContain("Bezig met herplaatsen");
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

    expect(buttons()[0]?.textContent).toContain("Bezig met herplaatsen");
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

    expect(buttons()[1]?.textContent).toContain("Bezig met herplaatsen");

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
    expect(text()).toContain("je limiet voor herplaatsingen");
  });
});

describe("when the backend refuses", () => {
  it("locks the row and says why, without pretending something broke", async () => {
    const { worker } = fakeWorker({ status: "refused", locked: { state: "upgrade", resetAt: null } });

    await show(worker);
    await press(0);

    expect(text()).toContain("je limiet voor herplaatsingen");
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

/**
 * Lock on the grant, never on the remainder (T32, #41).
 *
 * The list is told one thing about the plan and it is the ceiling, not what is
 * left under it. A tier granting nothing is a property of the **Tier** — only an
 * operator or a purchase moves it — so a button locked on it is a button that
 * will still be right in a minute. A spent period is not: it goes back up without
 * the holder acting, because a `FAILED_BEFORE_DELETE` refunds its unit and so does
 * reconciliation.
 */
describe("a plan that grants no reposts at all", () => {
  it("locks every row before anything is clicked, rather than after a round trip", async () => {
    const { worker } = fakeWorker();

    await show(worker, () => {}, { grantsNothing: true });

    expect(buttons().every((button) => button.disabled)).toBe(true);
    expect(buttons().every((button) => button.className.includes("mp-btn--locked"))).toBe(true);
  });

  it("so the click that used to cost a round trip cannot leave the popup", async () => {
    // What it was refused with is `upgrade`, and the sentence it came back with —
    // "you have reached your limit for this period" — is about a limit nobody on
    // this plan ever had.
    const { worker } = fakeWorker();

    await show(worker, () => {}, { grantsNothing: true });
    await press(0);

    expect(worker.relist).not.toHaveBeenCalled();
    expect(text()).not.toContain("je limiet voor herplaatsingen");
  });

  it("and leaves them live on a plan that has one, however little is left of it", async () => {
    // The list is never told the remainder, which is the design: there is no
    // number here that a refund could have moved since the popup opened.
    const { worker } = fakeWorker();

    await show(worker, () => {}, { grantsNothing: false });

    expect(buttons().every((button) => button.disabled)).toBe(false);
  });

  it("never strands an ad the extension is holding, however little the tier grants", async () => {
    // A `deleted` snapshot needs no fresh grant (`docs/enforcement-contract.md`):
    // the ad is already gone and finishing the relist only puts it back. A lock
    // that took Opnieuw with it would leave the listing inside the extension until
    // somebody bought a plan.
    const { worker } = fakeWorker({ status: "failed-recoverable", listingId: "m1", error: WIRE_ERROR, quota: QUOTA });

    await show(worker);
    await press(0);
    // An operator zeroes the tier while the ad is held, and the popup is refreshed
    // over the row that is holding it.
    await show(worker, () => {}, { grantsNothing: true });
    await press(0);

    expect(worker.retry).toHaveBeenCalledWith("m1");
    expect(worker.relist).toHaveBeenCalledTimes(1);
  });

  it("names the plan rather than a limit when a refusal does land on a row", async () => {
    // Reachable with the buttons locked: a stale popup can hold a refusal recorded
    // before the tier was zeroed.
    const { worker } = fakeWorker({ status: "refused", locked: { state: "upgrade", resetAt: null } });

    await show(worker);
    await press(0);
    await show(worker, () => {}, { grantsNothing: true });

    expect(text()).toContain("Dit abonnement bevat geen herplaatsingen");
    expect(text()).not.toContain("je limiet voor herplaatsingen");
  });
});

describe("a list in pages", () => {
  const page: AdPage = { number: 2, batchSize: 2, last: 4, landOn: null };
  const onPage = (ads = ADS, on = page): AdsView => ({ status: "ready", ads, total: 8, page: on });
  const onGoToPage = vi.fn();
  const onSavePosition = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    onGoToPage.mockClear();
    onSavePosition.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function draw(worker: WorkerPort, view: AdsView, refreshes = 0): Promise<void> {
    await act(async () => {
      root.render(
        <AdList
          view={view}
          worker={worker}
          onOutcome={() => {}}
          grantsNothing={false}
          onGoToPage={onGoToPage}
          onSavePosition={onSavePosition}
          refreshes={refreshes}
        />,
      );
    });
  }
  const pass = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
  const repostButtons = () => buttons().filter((button) => button.closest("li"));
  const barButton = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("nav button")].find((b) => b.textContent?.includes(label));

  describe("after a repost", () => {
    it("the row says so with every button locked, then leaves", async () => {
      const { worker } = fakeWorker();
      await draw(worker, onPage());
      await press(0);

      expect(repostButtons()[0]?.textContent).toBe("Herplaatst");
      expect(repostButtons()[1]?.disabled).toBe(true);

      await pass(LEAVING_MS - 1);
      expect(text()).toContain("Vintage Eames");

      await pass(1);
      expect(text()).not.toContain("Vintage Eames");
      expect(repostButtons()).toHaveLength(1);
      expect(repostButtons()[0]?.disabled).toBe(false);
    });

    it("counts it, and says where the copy is", async () => {
      const { worker } = fakeWorker();
      await draw(worker, onPage());
      await press(0);
      await pass(LEAVING_MS);

      expect(text()).toContain("1 herplaatst · ze staan bovenaan pagina 1");
    });

    it("on the first page only a refresh can show the copy, which then ends the count", async () => {
      const { worker } = fakeWorker();
      const first = onPage(ADS, { ...page, number: 1 });
      await draw(worker, first);
      await press(0);
      await pass(LEAVING_MS);
      expect(text()).toContain("1 herplaatst · ze staan bovenaan na Vernieuwen");

      await draw(worker, first, 1);
      expect(text()).not.toContain("herplaatst ·");
    });

    it("a repost that failed keeps its row", async () => {
      const { worker } = fakeWorker({ status: "failed-before-delete", error: WIRE_ERROR, quota: QUOTA });
      await draw(worker, onPage());
      await press(0);
      await pass(LEAVING_MS);

      expect(text()).toContain("Vintage Eames");
      expect(text()).not.toContain("herplaatst ·");
    });
  });

  describe("when the page's last row leaves", () => {
    const one = [ADS[0]!];

    it("the next page comes by itself, and only then", async () => {
      const { worker } = fakeWorker();
      await draw(worker, onPage());
      await press(0);
      await pass(LEAVING_MS);
      expect(onGoToPage).not.toHaveBeenCalled();

      await press(0);
      await pass(LEAVING_MS);
      expect(onGoToPage).toHaveBeenCalledWith(3, 2);
    });

    it("the buttons stay locked until the rows arrive", async () => {
      const { worker } = fakeWorker();
      await draw(worker, { ...onPage(ADS), moving: true } as AdsView);

      expect(repostButtons().every((button) => button.disabled)).toBe(true);
    });

    it("the last page says so, instead of claiming the account has no ads", async () => {
      const { worker } = fakeWorker();
      await draw(worker, onPage(one, { ...page, number: 4 }));
      await press(0);
      await pass(LEAVING_MS);

      expect(onGoToPage).not.toHaveBeenCalled();
      expect(text()).toContain("Alle advertenties op deze pagina zijn herplaatst.");
      expect(text()).not.toContain("geen actieve");
    });

    it("a seller who already moved on is not moved again", async () => {
      const { worker, hang, finish } = fakeWorker();
      hang();
      await draw(worker, onPage(one));
      await press(0);
      await draw(worker, onPage([ADS[1]!], { ...page, number: 3 }));
      await finish(RELISTED);
      await pass(LEAVING_MS);

      expect(onGoToPage).not.toHaveBeenCalled();
    });
  });

  describe("the saved position", () => {
    it("is written at the click, before the repost has done anything", async () => {
      const { worker, hang } = fakeWorker();
      hang();
      await draw(worker, onPage());
      await press(0);

      expect(onSavePosition).toHaveBeenCalledWith({ page: 2, batchSize: 2, nextAdId: "m2" });
    });

    it("is the next page's top after the page's last row", async () => {
      const { worker, hang } = fakeWorker();
      hang();
      await draw(worker, onPage());
      await press(1);

      expect(onSavePosition).toHaveBeenCalledWith({ page: 3, batchSize: 2, nextAdId: null });
    });
  });

  describe("the page bar", () => {
    it("says where the seller is and moves them", async () => {
      const { worker } = fakeWorker();
      await draw(worker, onPage());

      expect(text()).toContain("Pagina 2 van 4");
      await act(async () => barButton("Volgende")?.click());
      expect(onGoToPage).toHaveBeenLastCalledWith(3, 2);
      await act(async () => barButton("Vorige")?.click());
      expect(onGoToPage).toHaveBeenLastCalledWith(1, 2);
      await act(async () => barButton("«")?.click());
      expect(onGoToPage).toHaveBeenLastCalledWith(1, 2);
    });

    it("stops at either end", async () => {
      const { worker } = fakeWorker();
      await draw(worker, onPage(ADS, { ...page, number: 1 }));
      expect(barButton("Vorige")?.disabled).toBe(true);
      expect(barButton("«")?.disabled).toBe(true);

      await draw(worker, onPage(ADS, { ...page, number: 4 }));
      expect(barButton("Volgende")?.disabled).toBe(true);
    });

    it("is not there with one page, or on search results", async () => {
      const { worker } = fakeWorker();
      await draw(worker, onPage(ADS, { ...page, number: 1, last: 1 }));
      expect(container.querySelector("nav")).toBeNull();

      await draw(worker, { status: "ready", ads: ADS, total: 2 });
      expect(container.querySelector("nav")).toBeNull();
    });

    it("stays usable while a repost runs, with the rows it shows locked", async () => {
      const { worker, hang } = fakeWorker();
      hang();
      await draw(worker, onPage());
      await press(0);

      expect(barButton("Volgende")?.disabled).toBe(false);

      await draw(worker, onPage([ADS[1]!], { ...page, number: 3 }));
      expect(repostButtons()[0]?.disabled).toBe(true);
    });

    it("opens a new set of rows at the row it landed on, and otherwise at the top", async () => {
      const { worker } = fakeWorker();
      await draw(worker, onPage(ADS, { ...page, landOn: "m2" }));
      const list = container.querySelector("ul")!;
      const row = container.querySelector<HTMLElement>('[data-ad-id="m2"]')!;
      Object.defineProperty(row, "offsetTop", { value: 60 });
      await draw(worker, onPage([...ADS], { ...page, landOn: "m2" }));
      expect(list.scrollTop).toBe(60);

      await draw(worker, onPage([...ADS]));
      expect(list.scrollTop).toBe(0);
    });
  });

  describe("a repost whose row is off screen", () => {
    const elsewhere = onPage([ADS[1]!], { ...page, number: 3 });

    it("is named while it runs", async () => {
      const { worker, hang } = fakeWorker();
      hang();
      await draw(worker, onPage());
      await press(0);
      await draw(worker, elsewhere);

      expect(text()).toContain("Bezig: Vintage Eames lounge chair");
    });

    it("is counted when it finishes", async () => {
      const { worker, hang, finish } = fakeWorker();
      hang();
      await draw(worker, onPage());
      await press(0);
      await draw(worker, elsewhere);
      await finish(RELISTED);
      await pass(LEAVING_MS);

      expect(text()).toContain("1 herplaatst");
    });

    it("says it failed, and keeps saying so until the next one starts", async () => {
      const { worker, hang, finish } = fakeWorker();
      hang();
      await draw(worker, onPage());
      await press(0);
      await draw(worker, elsewhere);
      await finish({ status: "failed-before-delete", error: WIRE_ERROR, quota: QUOTA });

      expect(text()).toContain("Vintage Eames lounge chair: Er is niets herplaatst");

      await press(0);
      expect(text()).not.toContain("Vintage Eames lounge chair: Er is niets herplaatst");
    });

    it("runs on its row again when the seller comes back", async () => {
      const { worker, hang } = fakeWorker();
      hang();
      const here = onPage();
      await draw(worker, here);
      await press(0);
      await draw(worker, elsewhere);
      await draw(worker, here);

      expect(repostButtons()[0]?.textContent).toContain("Bezig met herplaatsen");
      expect(text()).not.toContain("Bezig: ");
    });
  });

  it("search results lose a row the same way, and write no position", async () => {
    const { worker } = fakeWorker();
    await draw(worker, { status: "ready", ads: [ADS[0]!], total: 1 });
    await press(0);
    await pass(LEAVING_MS);

    expect(onSavePosition).not.toHaveBeenCalled();
    expect(onGoToPage).not.toHaveBeenCalled();
    expect(text()).toContain("Alle gevonden advertenties zijn herplaatst.");
    expect(text()).toContain("1 herplaatst");
  });
});
