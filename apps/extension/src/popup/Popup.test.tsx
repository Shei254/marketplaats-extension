// @vitest-environment happy-dom
import type { DisplayState, Plan } from "@mprelist/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DisplayStateAnswer } from "../api/display-state";
import type { HandoffAnswer, PlansAnswer } from "../api/subscribing";
import type { WireRelistOutcome } from "../background/messages";
import { ASSUMED_RAILS } from "../domain/batch-estimate";
import { startBatch, stopBatch, type BatchRun } from "../domain/batch-run";
import { BULK_PACE } from "../domain/relist-pace";
import type { ListingSummary } from "../domain/types";
import { NoMarktplaatsTabError } from "../adapters/relay-marktplaats-client";
import { SignInCancelledError, SignInFailedError } from "../auth/errors";
import { Popup } from "./Popup";
import type { WorkerPort } from "./screen";

/**
 * The popup's routing, driven the way a user drives it: rendered into a real
 * document, clicked, and read back.
 *
 * A real DOM rather than static markup, because what this ticket adds is the
 * *transitions* — loading to a plan, a failed sign-in back to the sign-in screen,
 * sign-out to the screen it started on. Static rendering can show each of those
 * states and none of the moves between them.
 *
 * No testing library: React's own `act` and `createRoot` over happy-dom, which
 * this workspace already had. The component takes the worker as a port, so
 * nothing here needs Chrome.
 */
const PLAN: DisplayState = {
  subscriptionStatus: "ACTIVE",
  tier: { code: "free", name: "Free" },
  quotaRemaining: 2,
  relistQuotaPerPeriod: 3,
  resetAt: "2026-09-14T08:31:22.101Z",
  features: {},
};

const RELISTED: WireRelistOutcome = {
  status: "relisted",
  quota: { quotaRemaining: 1, resetAt: "2026-09-14T08:31:22.101Z" },
};

/** What `GET /api/plans` answers with — never the free tier and never a draft. */
const PRO: Plan = {
  tier: { code: "pro", name: "Pro" },
  relistQuotaPerPeriod: 50,
  features: {},
  prices: [{ amount: 999, currency: "eur", interval: "month" }],
};

const POWER: Plan = {
  tier: { code: "power", name: "Power" },
  relistQuotaPerPeriod: 200,
  features: {},
  prices: [{ amount: 1999, currency: "eur", interval: "month" }],
};

/** A Stripe page the worker has already opened a tab for; the popup is on its way out. */
const OPENED: HandoffAnswer = { status: "opened", url: "https://checkout.stripe.com/c/pay/cs_1" };

export const ADS: ListingSummary[] = [
  { id: "m1", title: "Vintage Eames lounge chair", priceCents: 125_000, priceType: "FIXED", biddingEnabled: false, reserved: false },
  { id: "m2", title: "Trek Marlin 7 mountainbike (M)", priceCents: 48_000, priceType: "FIXED", biddingEnabled: false, reserved: false },
];

function fakeWorker(
  answers: DisplayStateAnswer[] = [{ status: "ready", plan: PLAN }],
  ads: ListingSummary[] = ADS,
  /** What the three subscribing calls answer, when a test is about one of them. */
  subscribing: { plans?: PlansAnswer; checkout?: HandoffAnswer; portal?: HandoffAnswer } = {},
) {
  const asked: string[] = [];
  const queue = [...answers];
  /** Queries whose answer the test is holding: query → the resolve that frees it. */
  const held = new Map<string, ((found: ListingSummary[]) => void) | null>();
  const matching = (query: string): ListingSummary[] =>
    ads.filter((ad) => ad.title.toLowerCase().includes(query.toLowerCase()));
  const worker: WorkerPort = {
    displayState: vi.fn(async () => {
      asked.push("display-state");
      return queue.length > 1 ? (queue.shift() as DisplayStateAnswer) : (queue[0] as DisplayStateAnswer);
    }),
    ads: vi.fn(async () => {
      asked.push("list-ads");
      return ads;
    }),
    /**
     * Marktplaats's own filtering, stood in for by a substring match on the title
     * — the same rows, which is what the relay now answers with (T31, #40).
     *
     * A query named to `hold` answers only when the test releases it, which is
     * the only way to put two searches in flight at once and see which one the
     * screen believes.
     */
    searchAds: vi.fn((query: string): Promise<ListingSummary[]> => {
      asked.push(`search:${query}`);
      if (!held.has(query)) return Promise.resolve(matching(query));
      return new Promise<ListingSummary[]>((resolve) => held.set(query, resolve));
    }),
    relist: vi.fn(async () => {
      asked.push("relist");
      return RELISTED;
    }),
    retry: vi.fn(async () => {
      asked.push("retry");
      return RELISTED;
    }),
    /** No gap to wait out, which is what a first relist of the session meets (T46, #54). */
    msBeforeNextRelist: vi.fn(async () => 0),
    plans: vi.fn(async () => {
      asked.push("plans");
      return (
        subscribing.plans ??
        // The default answer carries the ways to pay because a real one always
        // does — `asPaymentMethods` returns `[]` rather than nothing when the
        // field is missing (T65, #137), so a double that omitted it would be
        // testing a shape the wire cannot produce.
        ({ status: "ready", plans: [PRO, POWER], paymentMethods: ["ideal", "paypal", "card"] } as PlansAnswer)
      );
    }),
    checkout: vi.fn(async (tierCode: string, interval: string) => {
      asked.push(`checkout:${tierCode}:${interval}`);
      return subscribing.checkout ?? OPENED;
    }),
    portal: vi.fn(async () => {
      asked.push("portal");
      return subscribing.portal ?? OPENED;
    }),
    signIn: vi.fn(async () => {
      asked.push("sign-in");
    }),
    signOut: vi.fn(async () => {
      asked.push("sign-out");
    }),
    /**
     * The batch calls (T68, #147). Answering `null` throughout is "this account
     * has no run", which is what every test in this file is about: the queue has
     * a suite of its own and the screens here are the ones that existed before it.
     */
    startBatch: vi.fn(async () => {
      asked.push("start-batch");
      return null;
    }),
    batchState: vi.fn(async () => null),
    batchShape: vi.fn(async () => ({ gap: BULK_PACE, rails: ASSUMED_RAILS })),
    stopBatch: vi.fn(async () => null),
    dismissBatch: vi.fn(async () => undefined),
  };
  return {
    worker,
    asked,
    /** Make this query's search hang, so a later one can overtake it. */
    hold: (query: string) => held.set(query, null),
    /** Let it answer, with the matches it would have had all along. */
    release: async (query: string) => {
      const resolve = held.get(query);
      held.delete(query);
      await act(async () => resolve?.(matching(query)));
    },
  };
}

let container: HTMLElement;
let root: Root;
/**
 * Whether the popup being rendered offers bulk (ADR-0027).
 *
 * **The default is the product's**, which is withdrawn — so every test outside the
 * batch block asserts against the screen a user actually gets. The block that
 * describes the selection turns it on in a `beforeEach`, which is what lets forty
 * tests written for T68 go on proving the screen works while nothing draws it.
 */
let offerBulk = false;

beforeEach(() => {
  offerBulk = false;
  (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function show(worker: WorkerPort): Promise<void> {
  await act(async () => {
    root.render(<Popup worker={worker} offerBulk={offerBulk} />);
  });
}

/**
 * What is on the screen — read from the rendered surface rather than from the
 * container, whose text also includes the two stylesheets the popup injects.
 */
const text = (): string => container.querySelector(".mp-root")?.textContent ?? "";

/**
 * Whitespace as a reader sees it.
 *
 * `Intl` puts a non-breaking space between `€` and the amount, so a button reading
 * "€ 9,99 per maand" does not match that string typed with an ordinary space — which
 * is a test failing over a character nobody can see.
 */
const readable = (text: string | null | undefined): string =>
  (text ?? "").replace(/\u00a0/g, " ").trim();

function click(label: string): Promise<void> {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) =>
      readable(candidate.textContent) === label || candidate.getAttribute("aria-label") === label,
  );
  if (!button) throw new Error(`no button labelled ${label} — screen reads: ${text()}`);
  return act(async () => {
    button.click();
  });
}

// Found by its label rather than by a class: the label is what the box *is* to
// somebody reading the screen, and the class is how it happens to be styled this
// month. The 2026-08 pass moved it onto `@mprelist/ui`'s own input and this
// assertion did not have to know.
const searchBox = (): HTMLInputElement | null =>
  container.querySelector<HTMLInputElement>('input[aria-label="Zie jouw advertenties"]');

/**
 * Type into the search box the way a person does.
 *
 * React tracks the last value it wrote on the node itself, so assigning `.value`
 * and firing `input` is a change React decides has not happened. Going through the
 * prototype's own setter is what clears that tracker.
 */
async function type(value: string): Promise<void> {
  const field = searchBox();
  if (!field) throw new Error(`no search box — screen reads: ${text()}`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
  await act(async () => field.dispatchEvent(new Event("input", { bubbles: true })));
}

/** Let the debounce run out, and whatever it started answer. */
async function settle(ms = 400): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe("signed in", () => {
  it("shows the plan, what is left of it and when it comes back", async () => {
    const { worker } = fakeWorker();

    await show(worker);

    expect(text()).toContain("Free");
    expect(text()).toContain("2 van 3 herplaatsingen over");
    expect(text()).toContain("Reset op 14 sep");
    // And no prompt: a healthy plan is the case where the screen says nothing
    // beyond what it is.
    expect(container.querySelector(".popup-prompt")).toBeNull();
  });

  it("asks again when refreshed, rather than redrawing what it had", async () => {
    const { worker, asked } = fakeWorker([
      { status: "ready", plan: PLAN },
      { status: "ready", plan: { ...PLAN, quotaRemaining: 1 } },
    ]);

    await show(worker);
    await click("Vernieuwen");

    expect(asked).toEqual(["display-state", "list-ads", "display-state", "list-ads"]);
    expect(text()).toContain("1 van 3 herplaatsingen over");
  });
});

describe("the ad list beneath the plan", () => {
  it("is asked for once the plan says there is a session, and rendered", async () => {
    const { worker, asked } = fakeWorker();

    await show(worker);

    expect(asked).toEqual(["display-state", "list-ads"]);
    expect(text()).toContain("Vintage Eames lounge chair");
    expect(text()).toContain("2 van 3 herplaatsingen over");
  });

  it("is never asked for when nobody is signed in", async () => {
    // The list is a request to marktplaats.nl in the user's own session, and the
    // contract's gating table has a signed-out popup make none.
    const { worker, asked } = fakeWorker([{ status: "signed-out" }]);

    await show(worker);

    expect(asked).toEqual(["display-state"]);
    expect(worker.ads).not.toHaveBeenCalled();
  });

  it("and not when the backend could not be reached either", async () => {
    const { worker, asked } = fakeWorker([{ status: "unavailable" }]);

    await show(worker);

    expect(asked).toEqual(["display-state"]);
  });

  it("failing does not take the plan down with it", async () => {
    // Two different places — ours and Marktplaats's. A user whose quota is fine
    // should be told that, beside the reason their ads are missing.
    const { worker } = fakeWorker();
    worker.ads = vi.fn(async () => {
      throw new NoMarktplaatsTabError();
    });

    await show(worker);

    expect(text()).toContain("2 van 3 herplaatsingen over");
    expect(text()).toContain("Je advertenties konden niet worden geladen.");
    expect(text()).toContain("Open marktplaats.nl in een tabblad");
  });

  it("says so plainly when the account has none", async () => {
    const { worker } = fakeWorker([{ status: "ready", plan: PLAN }], []);

    await show(worker);

    expect(text()).toContain("Je hebt geen actieve advertenties.");
  });
});

/**
 * The search box (T31, #40), driven by typing into it.
 *
 * Every assertion here is about **which requests leave** and **which answer is
 * allowed to reach the screen**, because that is the whole of what this ticket
 * adds: the filtering itself is Marktplaats's, and the rows are the ones the list
 * already draws.
 */
describe("searching the ad list", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the typing to stop, then asks once", async () => {
    // Five keystrokes, one request — the gap is measured from the last of them,
    // and each one is a request to marktplaats.nl in the user's own session.
    const { worker, asked } = fakeWorker();

    await show(worker);
    for (const value of ["t", "tr", "tre", "trek"]) await type(value);

    await settle(399);
    expect(asked.filter((question) => question.startsWith("search:"))).toEqual([]);

    await settle(1);
    expect(asked.filter((question) => question.startsWith("search:"))).toEqual(["search:trek"]);
  });

  it("asks nothing at all under two characters", async () => {
    // One letter matches most of an account: a request whose answer nobody wanted.
    const { worker, asked } = fakeWorker();

    await show(worker);
    await type("t");
    await settle(2000);

    expect(asked).toEqual(["display-state", "list-ads"]);
    expect(worker.searchAds).not.toHaveBeenCalled();
  });

  it("shows what came back, and only that", async () => {
    const { worker } = fakeWorker();

    await show(worker);
    await type("trek");
    await settle();

    expect(text()).toContain("Trek Marlin 7 mountainbike (M)");
    expect(text()).not.toContain("Vintage Eames lounge chair");
  });

  it("says what did not match, rather than that the account is empty", async () => {
    const { worker } = fakeWorker();

    await show(worker);
    await type("sofa");
    await settle();

    expect(text()).toContain("Geen advertenties gevonden voor “sofa”.");
    expect(text()).not.toContain("Je hebt geen actieve advertenties.");
  });

  it("never lets a slow answer overwrite a newer one", async () => {
    // The bug this exists to prevent: "tr" against a big account answering after
    // "trek" did, leaving matches for a query the box no longer holds.
    const { worker, asked, hold, release } = fakeWorker();

    await show(worker);
    hold("eames");
    await type("eames");
    await settle();
    await type("trek");
    await settle();

    expect(asked).toEqual(["display-state", "list-ads", "search:eames", "search:trek"]);
    expect(text()).toContain("Trek Marlin 7 mountainbike (M)");

    await release("eames");

    expect(text()).toContain("Trek Marlin 7 mountainbike (M)");
    expect(text()).not.toContain("Vintage Eames lounge chair");
  });

  it("gives the whole list back the moment the box is cleared", async () => {
    // No debounce on the way back: there is no request to save and nothing to
    // wait for, so 400ms of a filtered list would be a delay bought with nothing.
    const { worker, asked } = fakeWorker();

    await show(worker);
    await type("trek");
    await settle();
    await click("Zoekopdracht wissen");

    expect(asked).toEqual(["display-state", "list-ads", "search:trek", "list-ads"]);
    expect(searchBox()?.value).toBe("");
    expect(text()).toContain("Vintage Eames lounge chair");
  });

  it("and the same when it is deleted back under the minimum", async () => {
    const { worker, asked } = fakeWorker();

    await show(worker);
    await type("trek");
    await settle();
    await type("t");

    expect(asked).toEqual(["display-state", "list-ads", "search:trek", "list-ads"]);
  });

  it("repeats the search when the list is refreshed", async () => {
    // A box with a query in it and a button that quietly emptied it would be two
    // controls disagreeing about what was asked for.
    const { worker, asked } = fakeWorker();

    await show(worker);
    await type("trek");
    await settle();
    await click("Vernieuwen");

    expect(asked).toEqual(["display-state", "list-ads", "search:trek", "display-state", "search:trek"]);
    expect(searchBox()?.value).toBe("trek");
  });

  it("and after a repost, because the reposted ad has a new id", async () => {
    const { worker, asked } = fakeWorker();

    await show(worker);
    await type("trek");
    await settle();
    await click("Herplaats");

    expect(asked).toEqual(["display-state", "list-ads", "search:trek", "relist", "search:trek"]);
  });

  it("is not on the screen at all when nobody is signed in", async () => {
    const { worker } = fakeWorker([{ status: "signed-out" }]);

    await show(worker);

    expect(searchBox()).toBeNull();
  });

  it("is emptied by signing out, so the next session opens on the whole list", async () => {
    const { worker, asked } = fakeWorker([{ status: "ready", plan: PLAN }]);

    await show(worker);
    await type("trek");
    await settle();
    await click("Uitloggen");
    await click("Inloggen");

    expect(searchBox()?.value).toBe("");
    expect(asked.at(-1)).toBe("list-ads");
  });
});

describe("the quota after a relist", () => {
  it("comes from the call that spent it, not from a second /api/me", async () => {
    // `/complete` already answered with what the period has left. Asking again
    // would be a second read of the same subtraction — and one that can disagree
    // with the first if another relist lands in between.
    const { worker, asked } = fakeWorker();

    await show(worker);
    expect(text()).toContain("2 van 3 herplaatsingen over");

    await click("Herplaats");

    expect(text()).toContain("1 van 3 herplaatsingen over");
    expect(asked.filter((question) => question === "display-state")).toHaveLength(1);
  });

  it("but the ad list is re-read, because the ad has a new id", async () => {
    const { worker, asked } = fakeWorker();

    await show(worker);
    await click("Herplaats");

    expect(asked).toEqual(["display-state", "list-ads", "relist", "list-ads"]);
  });

  it("is left alone when the backend could not be told what happened", async () => {
    // `null` is "we do not know", which is not the same as unchanged — so the
    // strip keeps the last number it was actually given.
    const { worker } = fakeWorker();
    worker.relist = vi.fn(async () => ({ status: "relisted", quota: null }) as const);

    await show(worker);
    await click("Herplaats");

    expect(text()).toContain("2 van 3 herplaatsingen over");
  });
});

describe("a plan that cannot be relisted on", () => {
  it("says the period is spent, and when it comes back", async () => {
    const { worker } = fakeWorker([
      { status: "ready", plan: { ...PLAN, quotaRemaining: 0 } },
    ]);

    await show(worker);

    expect(text()).toContain("0 van 3 herplaatsingen over");
    expect(text()).toContain("Je hebt je limiet voor herplaatsingen in deze periode bereikt");
    expect(text()).toContain("Ze resetten op 14 sep");
  });

  it("says a card is failing without saying the plan is gone", async () => {
    // ADR-0018: dunning keeps the paid tier and Stripe is still retrying, so
    // "je abonnement is nog steeds Pro" is the load-bearing half of this copy — and
    // "resubscribe" would be addressed to somebody who has not cancelled.
    const { worker } = fakeWorker([
      {
        status: "ready",
        plan: { ...PLAN, subscriptionStatus: "PAST_DUE", tier: { code: "pro", name: "Pro" } },
      },
    ]);

    await show(worker);

    expect(text()).toContain("betaling mislukt");
    expect(text()).toContain("Je betaling is niet gelukt");
    expect(text()).toContain("je abonnement is nog steeds Pro");
    expect(text()).not.toContain("resubscribe");
  });

  it("and shows the ads all the same, because they are the conversion surface", async () => {
    // The list is never subscription-gated (`docs/enforcement-contract.md`): a
    // locked button beside the user's own ads is the strongest prompt there is.
    const { worker } = fakeWorker([
      { status: "ready", plan: { ...PLAN, quotaRemaining: 0 } },
    ]);

    await show(worker);

    expect(text()).toContain("Vintage Eames lounge chair");
  });
});

describe("signed out", () => {
  it("shows sign-in and nothing else", async () => {
    // ADR-0007's refinement, and the assertion is deliberately about absence: no
    // quota, no plan, no refresh — everything else on this surface is either the
    // user's own data or a number nobody has been asked for.
    const { worker } = fakeWorker([{ status: "signed-out" }]);

    await show(worker);

    expect(text()).toContain("Inloggen");
    expect(container.querySelector(".popup-plan")).toBeNull();
    expect(text()).not.toContain("reposts left");
    expect(text()).not.toContain("Free");
    expect(container.querySelector('[aria-label="Vernieuwen"]')).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("signs in, then asks what the plan is", async () => {
    const { worker, asked } = fakeWorker([{ status: "signed-out" }, { status: "ready", plan: PLAN }]);

    await show(worker);
    await click("Inloggen");

    expect(asked).toEqual(["display-state", "sign-in", "display-state", "list-ads"]);
    expect(text()).toContain("2 van 3 herplaatsingen over");
  });

  it("says nothing when the user closed the window themselves", async () => {
    // They are already looking at the screen that says what to do about it.
    const { worker } = fakeWorker([{ status: "signed-out" }]);
    worker.signIn = vi.fn(async () => {
      throw new SignInCancelledError();
    });

    await show(worker);
    await click("Inloggen");

    expect(text()).toContain("Inloggen");
    expect(text()).not.toContain("cancelled");
    expect(container.querySelector(".mp-note")).toBeNull();
  });

  it("repeats Keycloak's own words when sign-in actually failed", async () => {
    const { worker } = fakeWorker([{ status: "signed-out" }]);
    worker.signIn = vi.fn(async () => {
      throw new SignInFailedError("Keycloak refused the sign-in: invalid_client");
    });

    await show(worker);
    await click("Inloggen");

    expect(container.querySelector(".mp-note--error")?.textContent).toContain("invalid_client");
  });
});

describe("unavailable", () => {
  it("never shows a plan it could not confirm", async () => {
    // Fail-closed applies to display: the one thing this screen must not do is
    // draw a tier and a quota nobody answered with.
    const { worker } = fakeWorker([{ status: "unavailable" }]);

    await show(worker);

    expect(text()).toContain("is nu niet bereikbaar");
    expect(text()).toContain("Er is niets gewijzigd op Marktplaats");
    expect(text()).not.toContain("reposts left");
  });

  it("recovers when the backend comes back", async () => {
    const { worker } = fakeWorker([{ status: "unavailable" }, { status: "ready", plan: PLAN }]);

    await show(worker);
    await click("Opnieuw proberen");

    expect(text()).toContain("2 van 3 herplaatsingen over");
  });
});

describe("signing out", () => {
  it("goes straight back to the sign-in screen", async () => {
    const { worker, asked } = fakeWorker();

    await show(worker);
    await click("Uitloggen");

    expect(asked).toEqual(["display-state", "list-ads", "sign-out"]);
    expect(text()).toContain("Inloggen");
    expect(text()).not.toContain("2 van 3 herplaatsingen over");
  });

  it("still signs out when the worker could not finish the job", async () => {
    // Clearing the session is the worker's own first move (#32); a failure after
    // that must not leave a user looking at a plan they just left.
    const { worker } = fakeWorker();
    worker.signOut = vi.fn(async () => {
      throw new Error("the Keycloak session was not ended");
    });

    await show(worker);
    await click("Uitloggen");

    expect(text()).toContain("Inloggen");
  });
});

describe("the plan cards", () => {
  const SPENT: DisplayState = { ...PLAN, quotaRemaining: 0 };

  it("open from the prompt beside the locked ads, which is where the click belongs", async () => {
    // ADR-0007 leaves the ad list ungated precisely so the conversion click sits
    // next to the user's own ads. This is the button #79 refused to draw before
    // there was anywhere for it to go.
    const { worker, asked } = fakeWorker([{ status: "ready", plan: SPENT }]);

    await show(worker);
    await click("Bekijk abonnementen");

    expect(asked).toEqual(["display-state", "list-ads", "plans"]);
    expect(text()).toContain("Kies een abonnement");
    expect(text()).toContain("50 herplaatsingen per maand");
  });

  it("and from the header, so somebody who is not out of relists can still reach them", async () => {
    // The canvas draws no way in but the prompt, which would leave a paying
    // subscriber unable to reach their own billing — and ADR-0017 makes this popup
    // the account surface.
    const { worker } = fakeWorker();

    await show(worker);
    await click("Abonnementen");

    expect(text()).toContain("Kies een abonnement");
  });

  it("warn that Checkout takes over the screen, because it does", async () => {
    // The popup is destroyed the moment the tab takes focus (ADR-0017). A user who
    // is not told reads that as the click having failed.
    const { worker } = fakeWorker();

    await show(worker);
    await click("Abonnementen");

    expect(text()).toContain("Het afrekenen wordt geopend in een nieuw tabblad");
    expect(text()).toContain("je gaat dan terug naar Gratis en behoudt altijd toegang");
  });

  it("say what a buyer can pay with, before they leave for a page they have never seen", async () => {
    // The conversion point of T65 (#137): a Dutch buyer's question at this exact
    // moment is whether iDEAL is on the other side of that tab, and ADR-0006 chose
    // Stripe over a card-only arrangement to make sure it is. The default worker
    // answers `ideal, paypal, card`.
    const { worker } = fakeWorker();

    await show(worker);
    await click("Abonnementen");

    expect(text()).toContain("Je kunt betalen met iDEAL, PayPal of creditcard");
  });

  it("and say nothing at all when Stripe could not be asked what they are", async () => {
    // The line degrades on its own. Every card, rhythm and amount is still here —
    // which is the whole reason `GET /api/plans` carries the methods beside the
    // plans rather than refusing both together.
    const { worker } = fakeWorker(undefined, ADS, {
      plans: { status: "ready", plans: [PRO, POWER], paymentMethods: [] },
    });

    await show(worker);
    await click("Abonnementen");

    expect(text()).not.toContain("Pay with");
    expect(text()).toContain("Het afrekenen wordt geopend in een nieuw tabblad");
    expect(text()).toContain("9,99");
  });

  it("show the plan they are on beside the ones they could buy", async () => {
    const { worker } = fakeWorker();

    await show(worker);
    await click("Abonnementen");

    expect(text()).toContain("Free");
    expect(text()).toContain("Je abonnement");
    expect(text()).toContain("Pro");
    expect(text()).toContain("Power");
  });

  it("go back to the ads without asking the backend anything again", async () => {
    // The plan and the ads are both still in hand; a reload here would be a
    // second answer to a question nobody asked twice.
    const { worker, asked } = fakeWorker();

    await show(worker);
    await click("Abonnementen");
    await click("Terug");

    expect(asked).toEqual(["display-state", "list-ads", "plans"]);
    expect(text()).toContain("2 van 3 herplaatsingen over");
    expect(text()).not.toContain("Kies een abonnement");
  });

  it("say prices could not be loaded rather than showing a guessed one", async () => {
    const { worker } = fakeWorker(undefined, ADS, { plans: { status: "unavailable" } });

    await show(worker);
    await click("Abonnementen");

    expect(text()).toContain("De prijzen konden nu niet worden geladen");
    expect(text()).not.toContain("Upgrade");
  });

  it("and ask again when told to", async () => {
    const { worker, asked } = fakeWorker(undefined, ADS, { plans: { status: "unavailable" } });

    await show(worker);
    await click("Abonnementen");
    await click("Opnieuw proberen");

    expect(asked.filter((call) => call === "plans")).toHaveLength(2);
  });

  it("send somebody whose token expired back to the sign-in screen", async () => {
    // The ordinary way that happens is a popup left open. It is the same event
    // `/api/me` reports, so it gets the same screen rather than a note on this one.
    const { worker } = fakeWorker(undefined, ADS, { plans: { status: "signed-out" } });

    await show(worker);
    await click("Abonnementen");

    expect(text()).toContain("Inloggen");
    expect(text()).not.toContain("Kies een abonnement");
  });

  it("and a build the backend has stopped serving to the update screen", async () => {
    const { worker } = fakeWorker(undefined, ADS, { plans: { status: "outdated" } });

    await show(worker);
    await click("Abonnementen");

    expect(text()).toContain("moet worden bijgewerkt");
  });
});

describe("handing off to Stripe", () => {
  it("asks the worker to open Checkout for the tier and rhythm that was clicked", async () => {
    // The worker opens the tab, not this page: the tab takes focus and destroys
    // whoever asked, so a `chrome.tabs.create` awaited here would be awaited in a
    // page that no longer exists.
    const { worker, asked } = fakeWorker();

    await show(worker);
    await click("Abonnementen");
    await click("€ 9,99 per maand");

    expect(asked).toContain("checkout:pro:month");
  });

  /**
   * The other half of a plan sold two ways (T66): the rhythm the buyer picked is
   * the one that reaches Stripe.
   *
   * The card already drew a button per price (T62, #128) — what T66 changed is that
   * plans now actually have two, because the form that creates them writes both. So
   * this is where the choice a buyer makes becomes the Price they are charged, and
   * a card that sent the first rhythm whichever button was clicked would be an
   * annual button charging by the month.
   */
  it("and the rhythm the buyer picked, where a plan is sold both ways", async () => {
    const bothWays: Plan = {
      ...PRO,
      prices: [
        { amount: 999, currency: "eur", interval: "month" },
        { amount: 9900, currency: "eur", interval: "year" },
      ],
    };
    const { worker, asked } = fakeWorker(undefined, ADS, {
      plans: { status: "ready", plans: [bothWays], paymentMethods: [] },
    });

    await show(worker);
    await click("Abonnementen");
    await click("€ 99,00 per jaar");

    expect(asked).toContain("checkout:pro:year");
    expect(asked).not.toContain("checkout:pro:month");
  });

  it("says a plan is no longer on sale rather than that something broke", async () => {
    // What a client holding yesterday's cards gets, and nobody's error.
    const { worker } = fakeWorker(undefined, ADS, { checkout: { status: "gone" } });

    await show(worker);
    await click("Abonnementen");
    await click("€ 9,99 per maand");

    expect(text()).toContain("wordt niet meer aangeboden");
  });

  it("and says come back in a moment when Stripe could not be asked", async () => {
    const { worker } = fakeWorker(undefined, ADS, { checkout: { status: "unavailable" } });

    await show(worker);
    await click("Abonnementen");
    await click("€ 9,99 per maand");

    expect(text()).toContain("Het afrekenen kon niet worden geopend");
  });

  it("opens the Customer Portal from the plans screen", async () => {
    const { worker, asked } = fakeWorker();

    await show(worker);
    await click("Abonnementen");
    await click("Betaling beheren");

    expect(asked).toContain("portal");
  });

  it("and tells somebody who has never paid that there is nothing there", async () => {
    // Every free user who has not bought anything, which is most accounts — so it
    // is a sentence rather than an apology.
    const { worker } = fakeWorker(undefined, ADS, { portal: { status: "gone" } });

    await show(worker);
    await click("Abonnementen");
    await click("Betaling beheren");

    expect(text()).toContain("niets te beheren");
  });

  it("offers the Portal beside a failing card, which is where ADR-0018 puts it", async () => {
    // The 402 copy is "update your card", not "resubscribe" — nothing has been
    // cancelled, Stripe is still retrying, and the tier is still theirs.
    const failing: DisplayState = { ...PLAN, subscriptionStatus: "PAST_DUE", tier: { code: "pro", name: "Pro" } };
    const { worker, asked } = fakeWorker([{ status: "ready", plan: failing }]);

    await show(worker);
    expect(text()).toContain("Je betaling is niet gelukt");
    await click("Betaalgegevens bijwerken");

    expect(asked).toContain("portal");
  });

  it("and says so on that prompt when the Portal could not be opened", async () => {
    const failing: DisplayState = { ...PLAN, subscriptionStatus: "PAST_DUE", tier: { code: "pro", name: "Pro" } };
    const { worker } = fakeWorker([{ status: "ready", plan: failing }], ADS, {
      portal: { status: "unavailable" },
    });

    await show(worker);
    await click("Betaalgegevens bijwerken");

    expect(text()).toContain("betaalpagina kon niet worden geopend");
    // And the plan is still theirs: a failed hand-off changes nothing about it.
    expect(text()).toContain("Pro");
  });
});

/**
 * Meerdere tegelijk herplaatsen (T68, #147; ADR-0025), through the real components:
 * the boxes on the rows, the bar under them, and what the screen does when the
 * worker says a run has ended.
 *
 * **The run itself is not tested here** — it belongs to the worker and has two
 * suites of its own. What can only go wrong on this side is the part that is about
 * a person: which ads get sent, in what order, what a free user sees instead, and
 * whether the list is reloaded once at the end rather than under a queue that is
 * still holding the old ids.
 */
describe("reposting several at once", () => {
  // On for this block and off everywhere else (ADR-0027): what follows is the
  // screen T68 built, kept under test while the product does not draw it.
  beforeEach(() => {
    offerBulk = true;
  });

  const PRO_PLAN: DisplayState = {
    ...PLAN,
    tier: { code: "pro", name: "Pro" },
    quotaRemaining: 20,
    relistQuotaPerPeriod: 50,
    features: { bulk: { upTo: 10 } },
  };

  /**
   * A dozen ads, so a Pro cap of ten is a cap the list can actually reach. The two
   * in `ADS` cannot — which is a state worth testing too, and a different one.
   */
  const MANY: ListingSummary[] = Array.from({ length: 12 }, (unused, at) => ({
    id: `many${at}`,
    title: `Ad number ${at}`,
    priceCents: 1000 * (at + 1),
    priceType: "FIXED",
    biddingEnabled: false,
    reserved: false,
  }));

  /** The worker with a run it actually remembers, so the popup can watch one. */
  function batching(plan: DisplayState = PRO_PLAN, ads: ListingSummary[] = ADS) {
    const fixture = fakeWorker([{ status: "ready", plan }], ads);
    let run: BatchRun | null = null;
    fixture.worker.startBatch = vi.fn(async (listingIds: string[]) => {
      fixture.asked.push("start-batch");
      run = startBatch(listingIds, 1_700_000_000_000);
      return run;
    });
    fixture.worker.batchState = vi.fn(async () => run);
    fixture.worker.stopBatch = vi.fn(async () => {
      run = run === null ? null : stopBatch(run, "stopped");
      return run;
    });
    fixture.worker.dismissBatch = vi.fn(async () => {
      run = null;
    });
    return { ...fixture, started: () => run };
  }

  const boxes = (): HTMLInputElement[] => [...container.querySelectorAll<HTMLInputElement>(".popup-ad-tick")];

  /**
   * The sentence each row's box carries, read off the wrapper it hangs on rather
   * than off the input — which is the whole point of the wrapper: Chrome draws no
   * tooltip for a disabled control, and the disabled ones are the boxes with
   * something to explain.
   */
  const tickTitles = (): string[] =>
    [...container.querySelectorAll(".popup-ad-tick-slot")].map((slot) => slot.getAttribute("title") ?? "");

  const selectAllTitle = (): string =>
    container.querySelector(".popup-select-all-label")?.getAttribute("title") ?? "";

  /** The header's own box, which is a different control from the ones on the rows. */
  const selectAllBox = (): HTMLInputElement | null =>
    container.querySelector<HTMLInputElement>(".popup-select-all-tick");

  const selectAll = (): Promise<void> =>
    act(async () => {
      const box = selectAllBox();
      if (!box) throw new Error(`no Select all box — screen reads: ${text()}`);
      box.click();
    });

  /** Which rows are ticked, by the position they hold in the list on screen. */
  const ticked = (): number[] => boxes().flatMap((box, at) => (box.checked ? [at] : []));

  const tick = (nth: number): Promise<void> =>
    act(async () => {
      boxes()[nth]?.click();
    });

  /**
   * What the product actually ships (T70, #155; ADR-0027).
   *
   * Every other test in this block turns bulk on. This one turns it back off,
   * which is the only arrangement a user can currently reach — and it is asserted
   * against **Pro**, because withdrawn and not-entitled are different facts: the
   * entitlement still grants, and the screen still declines to ask.
   */
  it("draws none of it while bulk is withdrawn, even on a plan that includes it", async () => {
    offerBulk = false;
    const { worker } = batching(PRO_PLAN, MANY);

    await show(worker);

    expect(boxes()).toHaveLength(0);
    expect(selectAllBox()).toBeNull();
    expect(container.querySelector(".popup-batch")).toBeNull();
    // Nor the line pointing at Plans, which is the sentence a free user gets: it
    // is written to make somebody want the feature, and no plan on sale can grant
    // it while this is off.
    expect(text()).not.toContain("hoort bij de betaalde abonnementen");
    // And nothing else went with it. This took away a selection, not the list.
    expect(container.querySelectorAll(".popup-ad")).toHaveLength(MANY.length);
    expect(text()).toContain("Herplaats");
  });

  it("and still asks the worker for a run, so a badge left by the last build comes down", async () => {
    offerBulk = false;
    const { worker } = batching();

    await show(worker);

    // The answer is thrown away — reading the state is what takes the toolbar
    // mark down (`BatchRunner.state`), and there is no bar left to explain one.
    expect(worker.batchState).toHaveBeenCalled();
  });

  it("puts a box on every row for a plan that includes it", async () => {
    const { worker } = batching();

    await show(worker);

    expect(boxes()).toHaveLength(ADS.length);
    expect(boxes().every((box) => box.disabled)).toBe(false);
  });

  // The conversion surface, one screen further in (ADR-0007): a free user sees the
  // control they do not have, beside their own ads and beside a Repost button that
  // still works. Drawn disabled rather than hidden is the whole difference between
  // a feature somebody knows to want and one they never learn exists.
  it("but draws them disabled on a plan that does not, beside a line pointing at Plans", async () => {
    const { worker } = batching(PLAN);

    await show(worker);

    expect(boxes()).toHaveLength(ADS.length);
    expect(boxes().every((box) => box.disabled)).toBe(true);
    expect(text()).toContain("hoort bij de betaalde abonnementen");
  });

  // The pinned line answers the list; the tooltip answers the control. A pointer
  // resting on a box that will not tick is the one moment the question is being
  // asked about *that* box, and Chrome draws no tooltip for a disabled input — so
  // the sentence hangs on the wrapper, and this asserts it is reachable there.
  it("and each of those boxes carries the reason it will not tick", async () => {
    const { worker } = batching(PLAN);

    await show(worker);

    expect(tickTitles()).toHaveLength(ADS.length);
    expect(tickTitles().every((why) => why.includes("betaalde abonnementen"))).toBe(true);
    expect(selectAllTitle()).toContain("betaalde abonnementen");
  });

  it("and says how many Select all would tick on a plan that has it", async () => {
    const { worker } = batching(PRO_PLAN, MANY);

    await show(worker);

    expect(selectAllTitle()).toBe("Vink de eerste 10 advertenties aan en herplaats ze in één reeks.");
  });

  // The cap said where the pointer is, not only in the header: a box that has gone
  // dead because ten are already ticked is the one control the user is asking
  // about, and "your plan reposts ten at a time" is the answer.
  it("and the boxes the cap has stopped say which number ran out", async () => {
    const { worker } = batching(PRO_PLAN, MANY);
    await show(worker);

    await selectAll();

    const stopped = boxes().flatMap((box, at) => (box.disabled ? [tickTitles()[at] ?? ""] : []));
    expect(stopped).not.toHaveLength(0);
    expect(stopped.every((why) => why === "Je abonnement herplaatst er 10 tegelijk.")).toBe(true);
  });

  // And the per-row button is untouched, which is the sentence the whole
  // entitlement rests on: bulk sells convenience, not capability.
  it("and leaves the per-row Repost working on that plan", async () => {
    const { worker } = batching(PLAN);

    await show(worker);

    expect([...container.querySelectorAll("button")].some((button) => readable(button.textContent) === "Herplaats")).toBe(
      true,
    );
  });

  // The one thing this sentence is served for: an operator who drops the burst
  // limit on a bad night changes it with a restart of the API rather than a store
  // release, and the popup has no other way to stop quoting a duration that is no
  // longer true. A build that read only its own numbers would pass every other
  // test here.
  it("quotes the rails the API served rather than the ones this build ships", async () => {
    const fixture = batching();
    fixture.worker.batchShape = vi.fn(async () => ({
      gap: BULK_PACE,
      rails: { burstLimit: 1, burstWindowMs: 60 * 60_000 },
    }));
    await show(fixture.worker);

    await tick(0);
    await tick(1);

    expect(text()).toContain("ongeveer 1 uur");
    expect(text()).toContain("gepauzeerd");
  });

  it("says how many are ticked and how long they will take", async () => {
    const { worker } = batching();
    await show(worker);

    await tick(0);
    await tick(1);

    expect(text()).toContain("Herplaats 2 geselecteerd");
    // Two ads is one gap of the wider window — minder dan een minuut, and said before
    // anybody commits to it.
    expect(text()).toContain("minder dan een minuut");
  });

  // The order is the screen's rather than the order they were ticked: somebody who
  // ticks the bottom row first has still read the list top to bottom, and a queue
  // that ran backwards would look like a bug from the first ad.
  it("sends the ads in the order the list is showing them", async () => {
    const fixture = batching();
    await show(fixture.worker);
    await tick(1);
    await tick(0);

    await click("Herplaats 2 geselecteerd · minder dan een minuut");

    expect(fixture.worker.startBatch).toHaveBeenCalledWith([ADS[0]!.id, ADS[1]!.id]);
  });

  // The cap is `min(quotaRemaining, upTo)` and this is the quota half of it: a
  // selection bigger than the period has left is ads the gate would refuse one
  // after another, each costing an attempt and a wait.
  it("stops ticking at what the period has left", async () => {
    const { worker } = batching({ ...PRO_PLAN, quotaRemaining: 1 });
    await show(worker);

    await tick(0);

    expect(boxes()[1]?.disabled).toBe(true);
    expect(text()).toContain("Meer herplaatsingen heb je deze periode niet");
  });

  it("and says it is the plan's number when that is the smaller one", async () => {
    const { worker } = batching({ ...PRO_PLAN, quotaRemaining: 20, features: { bulk: { upTo: 1 } } });
    await show(worker);

    await tick(0);

    expect(boxes()[1]?.disabled).toBe(true);
    expect(text()).toContain("herplaatst er 1 tegelijk");
  });

  it("shows the run once it has started, and offers to stop it", async () => {
    const fixture = batching();
    await show(fixture.worker);
    await tick(0);

    await click("Herplaats 1 geselecteerd · minder dan een minuut");

    expect(text()).toContain("Bezig met herplaatsen 1 van 1…");
    expect(text()).toContain("gaat door als de pop-up gesloten is");
  });

  // Every row is locked while a run is going, for the reason one relist locks the
  // others: the queue is the serialisation now, and a row pressed mid-run would be
  // a second delete beside the one in flight.
  it("and locks every box while it is going", async () => {
    const fixture = batching();
    await show(fixture.worker);
    await tick(0);

    await click("Herplaats 1 geselecteerd · minder dan een minuut");

    expect(boxes().every((box) => box.disabled)).toBe(true);
  });

  it("stops when asked, and says what it got through", async () => {
    const fixture = batching();
    await show(fixture.worker);
    await tick(0);
    await tick(1);
    await click("Herplaats 2 geselecteerd · minder dan een minuut");

    await click("Stoppen");

    expect(text()).toContain("0 van 2 herplaatst.");
    expect(text()).toContain("Gestopt.");
  });

  // The ads that never ran are offered rather than resumed, which is ADR-0025's
  // browser-restart rule made visible: a queue that picked itself up would be
  // delete-first firing at ads nobody is thinking about, and a button is a person
  // deciding.
  it("and offers to repost the ads it never started", async () => {
    const fixture = batching();
    await show(fixture.worker);
    await tick(0);
    await tick(1);
    await click("Herplaats 2 geselecteerd · minder dan een minuut");

    await click("Stoppen");

    expect(text()).toContain("Herplaats de resterende 2");
  });

  /**
   * **The cap moves, and the boxes cannot catch it.**
   *
   * They enforce it at the moment of ticking, which is not the moment of starting.
   * `quotaRemaining` comes back from `/complete` and this screen believes it at
   * once (T32, #41), so one press of a row's own Repost while rows are ticked
   * leaves a selection larger than the plan can pay for — every box still ticked,
   * and a button that used to be true.
   */
  it("counts what it will really start when the quota falls under a standing selection", async () => {
    const fixture = batching({ ...PRO_PLAN, quotaRemaining: 2 }, MANY);
    await show(fixture.worker);
    await tick(0);
    await tick(1);
    expect(text()).toContain("Herplaats 2 geselecteerd");

    // A single repost, which the fake answers with one relist left.
    await click("Herplaats");

    expect(text()).toContain("Herplaats 1 van 2 geselecteerd");
  });

  it("and starts exactly the ads that button named", async () => {
    const fixture = batching({ ...PRO_PLAN, quotaRemaining: 2 }, MANY);
    await show(fixture.worker);
    await tick(0);
    await tick(1);
    await click("Herplaats");

    await click("Herplaats 1 van 2 geselecteerd · minder dan een minuut");

    expect(fixture.worker.startBatch).toHaveBeenCalledWith([MANY[0]!.id]);
  });

  // And with nothing left at all, the reason stands where the button was rather
  // than a button that would start nothing.
  it("and says why instead of offering a button it cannot honour", async () => {
    const fixture = batching({ ...PRO_PLAN, quotaRemaining: 1 }, MANY);
    fixture.worker.relist = vi.fn(async () => ({
      status: "relisted",
      quota: { quotaRemaining: 0, resetAt: "2026-09-14T08:31:22.101Z" },
    }) as const);
    await show(fixture.worker);
    await tick(0);

    await click("Herplaats");

    expect(text()).not.toContain("Herplaats 1 geselecteerd");
    expect(text()).toContain("Meer herplaatsingen heb je deze periode niet.");
  });

  /**
   * **The cap has to hold on the way back in, too.**
   *
   * Every other route into a run goes through the checkboxes, which stop ticking
   * at `min(quotaRemaining, upTo)`. This one does not go near them: a run that
   * spent the quota it started with leaves its ads behind, and an offer to repost
   * all of them is a queue the period cannot pay for — twenty authorizes refused
   * one after another, with the first ad deleted before the refusals begin.
   */
  it("caps the ads a stopped run offers, and starts only the ones it named", async () => {
    const fixture = batching({ ...PRO_PLAN, quotaRemaining: 2 }, MANY);
    const left = MANY.slice(0, 5).map((ad) => ad.id);
    // A run stopped with more left over than the period can now pay for.
    fixture.worker.batchState = vi.fn(async () => stopBatch(startBatch(left, 1_700_000_000_000), "stopped"));
    await show(fixture.worker);

    await click("Herplaats 2 van de resterende 5");

    expect(fixture.worker.startBatch).toHaveBeenCalledWith(left.slice(0, 2));
  });

  // And when it can pay for none of them, the reason stands where the button was:
  // a control that does nothing is the shape of a bug, which is the argument the
  // selection header is built on.
  it("and when nothing is left to spend, says so instead of offering a dead button", async () => {
    const fixture = batching({ ...PRO_PLAN, quotaRemaining: 0 }, MANY);
    const left = MANY.slice(0, 5).map((ad) => ad.id);
    fixture.worker.batchState = vi.fn(async () => stopBatch(startBatch(left, 1_700_000_000_000), "stopped"));

    await show(fixture.worker);

    expect(text()).not.toContain("Repost the remaining");
    expect(text()).toContain("Meer herplaatsingen heb je deze periode niet.");
  });

  // A reposted ad comes back with a new id, so reloading mid-run would reshuffle
  // the rows under a queue holding the old ones. Once, at the end.
  it("reloads the list once, when the run has ended", async () => {
    const fixture = batching();
    await show(fixture.worker);
    const loadsBefore = fixture.asked.filter((ask) => ask === "list-ads").length;
    await tick(0);
    await click("Herplaats 1 geselecteerd · minder dan een minuut");

    await click("Stoppen");

    expect(fixture.asked.filter((ask) => ask === "list-ads")).toHaveLength(loadsBefore + 1);
  });

  it("and clears the run when it is dismissed", async () => {
    const fixture = batching();
    await show(fixture.worker);
    await tick(0);
    await click("Herplaats 1 geselecteerd · minder dan een minuut");
    await click("Stoppen");

    await click("Sluiten");

    expect(text()).not.toContain("reposted.");
  });

  /**
   * **The bug that made this whole feature look broken.**
   *
   * A stopped run is held until it is dismissed — that is what lets somebody close
   * the popup, come back and still read what their batch did. But for as long as
   * that summary was the only thing the bar could draw, a second selection had
   * nowhere to appear: boxes ticked, the count went up, and no button showed up
   * anywhere on the screen. Nothing said why, because from the code's point of
   * view nothing had gone wrong.
   */
  it("offers a fresh selection while a stopped run is still on the screen", async () => {
    const fixture = batching();
    await show(fixture.worker);
    await tick(0);
    await click("Herplaats 1 geselecteerd · minder dan een minuut");
    await click("Stoppen");

    await tick(1);

    expect(text()).toContain("Herplaats 1 geselecteerd");
  });

  // And it is one offer rather than two: the ads a stopped run never reached and
  // the ads just ticked are different batches, and a strip with a button for each
  // would be asking the user to tell them apart before starting either.
  it("and drops the offer to repost the unstarted ones while it stands", async () => {
    const fixture = batching();
    await show(fixture.worker);
    await tick(0);
    await tick(1);
    await click("Herplaats 2 geselecteerd · minder dan een minuut");
    await click("Stoppen");
    expect(text()).toContain("Herplaats de resterende 2");

    await tick(0);

    expect(text()).not.toContain("Repost the remaining");
    expect(text()).toContain("Herplaats 1 geselecteerd");
  });

  // The summary itself does not go anywhere: it is the only record of what the last
  // run did, and a selection is not news that makes it untrue.
  it("without losing what the stopped run had got through", async () => {
    const fixture = batching();
    await show(fixture.worker);
    await tick(0);
    await click("Herplaats 1 geselecteerd · minder dan een minuut");
    await click("Stoppen");

    await tick(1);

    expect(text()).toContain("0 van 1 herplaatst.");
    expect(text()).toContain("Gestopt.");
  });

  /**
   * Selecting several at once, which is the act the entitlement actually sells.
   *
   * A plan that reposts twenty-five ads in one go is not worth much if starting it
   * costs twenty-five clicks — that is the feature performed by hand, which is what
   * the extension exists to stop.
   */
  it("ticks the whole list from the header", async () => {
    const { worker } = batching();
    await show(worker);

    await selectAll();

    expect(ticked()).toEqual([0, 1]);
    expect(text()).toContain("Herplaats 2 geselecteerd");
  });

  // The cap is applied where the plan is read, and from the top: the ten a Pro user
  // gets are the ten they were already looking at.
  it("but never more than the plan reposts at a time", async () => {
    const { worker } = batching({ ...PRO_PLAN, features: { bulk: { upTo: 1 } } });
    await show(worker);

    await selectAll();

    expect(ticked()).toEqual([0]);
    expect(text()).toContain("herplaatst er 1 tegelijk");
  });

  // The other half of the same cap, and the one a bigger plan does not fix.
  it("nor more than the period has left", async () => {
    const { worker } = batching({ ...PRO_PLAN, quotaRemaining: 1 });
    await show(worker);

    await selectAll();

    expect(ticked()).toEqual([0]);
  });

  it("says how much of the cap the selection has spent", async () => {
    const { worker } = batching(PRO_PLAN, MANY);
    await show(worker);

    await tick(0);

    expect(text()).toContain("1 van 10 geselecteerd");
  });

  // But only while the cap is a number the list can actually reach. Two ads on a
  // plan that reposts ten are two ads, and "2 van 10 geselecteerd" beside a Select all
  // box that is — correctly — full invents eight ads the account does not have.
  it("but counts plainly when the list is shorter than the cap", async () => {
    const { worker } = batching();
    await show(worker);

    await selectAll();

    expect(text()).toContain("2 geselecteerd");
    expect(text()).not.toContain("2 van 10 geselecteerd");
  });

  // Select all after a few rows have been ticked by hand adds to them rather than
  // throwing them away — which is what "select all" means anywhere else, and the
  // difference between a control that helps and one that undoes your work.
  it("and adds to a selection rather than replacing it", async () => {
    const { worker } = batching({ ...PRO_PLAN, features: { bulk: { upTo: 3 } } }, MANY);
    await show(worker);
    await tick(11);

    await selectAll();

    expect(ticked()).toEqual([0, 1, 11]);
  });

  // Said before the cap bites rather than after. Without this line the only way to
  // learn a plan reposts ten at a time is to tick an eleventh box and find it
  // inert, which is a control going dead with no sentence anywhere near it.
  it("and how many it allows before anything is ticked", async () => {
    const { worker } = batching();

    await show(worker);

    expect(text()).toContain("10 tegelijk");
  });

  it("unticks everything from the header", async () => {
    const { worker } = batching();
    await show(worker);
    await selectAll();

    await click("Wissen");

    expect(ticked()).toEqual([]);
    expect(text()).not.toContain("Herplaats 2 geselecteerd");
  });

  // The same box, both ways: a full selection is unticked by the control that
  // ticked it, which is what every list of checkboxes on every platform does.
  it("and from the box that ticked it, once it is full", async () => {
    const { worker } = batching();
    await show(worker);
    await selectAll();
    expect(selectAllBox()?.checked).toBe(true);

    await selectAll();

    expect(ticked()).toEqual([]);
  });

  /**
   * The silent failure this header was added for.
   *
   * A spent quota caps the selection at zero, which disabled every box on the
   * screen — and because nothing could be ticked, the bar that explains a cap never
   * appeared either. The user met a list of dead controls with no sentence anywhere
   * on it, which is indistinguishable from something broken.
   */
  it("says why nothing can be ticked when the period has nothing left", async () => {
    const { worker } = batching({ ...PRO_PLAN, quotaRemaining: 0 });

    await show(worker);

    expect(text()).toContain("Geen herplaatsingen over");
    expect(selectAllBox()?.disabled).toBe(true);
    expect(boxes().every((box) => box.disabled)).toBe(true);
  });

  // Drawn on the free tier too, inert with the boxes it is about: the conversion
  // argument that keeps those boxes on screen (ADR-0007) is the same one that keeps
  // this row, and a header that vanished would make a locked list look like a list
  // with nothing to select.
  it("and is drawn disabled on a plan that does not include bulk", async () => {
    const { worker } = batching(PLAN);

    await show(worker);

    expect(selectAllBox()).not.toBeNull();
    expect(selectAllBox()?.disabled).toBe(true);
  });

  // The header is not offered over a list with no rows in it: there is nothing to
  // select all of, and a control for an empty list is a control that cannot work.
  it("but not over a list with nothing in it", async () => {
    const fixture = fakeWorker([{ status: "ready", plan: PRO_PLAN }], []);

    await show(fixture.worker);

    expect(selectAllBox()).toBeNull();
  });

  /**
   * **A selection survives the search box, and the screen says what that costs.**
   *
   * Picking ten ads out of forty is a job for the search box, so a query that
   * silently unticked what had already been chosen would make the only workable way
   * to do it impossible. The tick stays. What must not stay is the ambiguity: the
   * count is bigger than the ticked boxes on screen, and reposting deletes first
   * (ADR-0003), so the ads that are about to be reposted out of sight are named
   * rather than left to be inferred.
   */
  it("keeps ticked ads a search has hidden, and says how many", async () => {
    vi.useFakeTimers();
    try {
      const fixture = batching();
      await show(fixture.worker);
      await selectAll();

      await type("Eames");
      await settle();

      expect(boxes()).toHaveLength(1);
      expect(text()).toContain("2 van 10 geselecteerd");
      expect(text()).toContain("1 aangevinkte advertentie staat niet in deze resultaten");
      expect(text()).toContain("Herplaats 2 geselecteerd");
    } finally {
      vi.useRealTimers();
    }
  });

  // And they are still in the batch, in the list's order for the ones on screen and
  // the order they were ticked for the rest.
  it("and reposts them too", async () => {
    vi.useFakeTimers();
    try {
      const fixture = batching();
      await show(fixture.worker);
      await selectAll();
      await type("Eames");
      await settle();

      await click("Herplaats 2 geselecteerd · minder dan een minuut");

      expect(fixture.worker.startBatch).toHaveBeenCalledWith([ADS[0]!.id, ADS[1]!.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  // The one thing a hidden tick must never do is go unnoticed once it is gone.
  it("and stops saying so once the list is showing all of them again", async () => {
    vi.useFakeTimers();
    try {
      const fixture = batching();
      await show(fixture.worker);
      await selectAll();
      await type("Eames");
      await settle();

      await click("Zoekopdracht wissen");
      await settle();

      expect(text()).not.toContain("aren’t in these results");
      expect(text()).not.toContain("isn’t in these results");
    } finally {
      vi.useRealTimers();
    }
  });
});
