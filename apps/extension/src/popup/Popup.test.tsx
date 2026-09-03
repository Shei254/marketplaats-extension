// @vitest-environment happy-dom
import type { DisplayState, Plan } from "@mprelist/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DisplayStateAnswer } from "../api/display-state";
import type { HandoffAnswer, PlansAnswer } from "../api/subscribing";
import type { WireRelistOutcome } from "../background/messages";
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
  { id: "m1", title: "Vintage Eames lounge chair", priceCents: 125_000 },
  { id: "m2", title: "Trek Marlin 7 mountainbike (M)", priceCents: 48_000 },
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

async function show(worker: WorkerPort): Promise<void> {
  await act(async () => {
    root.render(<Popup worker={worker} />);
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
 * "€ 9,99 a month" does not match that string typed with an ordinary space — which
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
  container.querySelector<HTMLInputElement>('input[aria-label="Search your ads"]');

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
    expect(text()).toContain("2 of 3 relists left");
    expect(text()).toContain("resets 14 Sep");
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
    await click("Refresh");

    expect(asked).toEqual(["display-state", "list-ads", "display-state", "list-ads"]);
    expect(text()).toContain("1 of 3 relists left");
  });
});

describe("the ad list beneath the plan", () => {
  it("is asked for once the plan says there is a session, and rendered", async () => {
    const { worker, asked } = fakeWorker();

    await show(worker);

    expect(asked).toEqual(["display-state", "list-ads"]);
    expect(text()).toContain("Vintage Eames lounge chair");
    expect(text()).toContain("2 of 3 relists left");
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

    expect(text()).toContain("2 of 3 relists left");
    expect(text()).toContain("Could not load your ads.");
    expect(text()).toContain("Open marktplaats.nl in a tab");
  });

  it("says so plainly when the account has none", async () => {
    const { worker } = fakeWorker([{ status: "ready", plan: PLAN }], []);

    await show(worker);

    expect(text()).toContain("You have no active ads.");
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

    expect(text()).toContain("No ads match “sofa”.");
    expect(text()).not.toContain("You have no active ads.");
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
    await click("Clear search");

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
    await click("Refresh");

    expect(asked).toEqual(["display-state", "list-ads", "search:trek", "display-state", "search:trek"]);
    expect(searchBox()?.value).toBe("trek");
  });

  it("and after a repost, because the reposted ad has a new id", async () => {
    const { worker, asked } = fakeWorker();

    await show(worker);
    await type("trek");
    await settle();
    await click("Repost");

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
    await click("Sign out");
    await click("Sign in");

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
    expect(text()).toContain("2 of 3 relists left");

    await click("Repost");

    expect(text()).toContain("1 of 3 relists left");
    expect(asked.filter((question) => question === "display-state")).toHaveLength(1);
  });

  it("but the ad list is re-read, because the ad has a new id", async () => {
    const { worker, asked } = fakeWorker();

    await show(worker);
    await click("Repost");

    expect(asked).toEqual(["display-state", "list-ads", "relist", "list-ads"]);
  });

  it("is left alone when the backend could not be told what happened", async () => {
    // `null` is "we do not know", which is not the same as unchanged — so the
    // strip keeps the last number it was actually given.
    const { worker } = fakeWorker();
    worker.relist = vi.fn(async () => ({ status: "relisted", quota: null }) as const);

    await show(worker);
    await click("Repost");

    expect(text()).toContain("2 of 3 relists left");
  });
});

describe("a plan that cannot be relisted on", () => {
  it("says the period is spent, and when it comes back", async () => {
    const { worker } = fakeWorker([
      { status: "ready", plan: { ...PLAN, quotaRemaining: 0 } },
    ]);

    await show(worker);

    expect(text()).toContain("0 of 3 relists left");
    expect(text()).toContain("You’ve used your relists for this period");
    expect(text()).toContain("They come back on 14 Sep");
  });

  it("says a card is failing without saying the plan is gone", async () => {
    // ADR-0018: dunning keeps the paid tier and Stripe is still retrying, so
    // "your plan is still Pro" is the load-bearing half of this copy — and
    // "resubscribe" would be addressed to somebody who has not cancelled.
    const { worker } = fakeWorker([
      {
        status: "ready",
        plan: { ...PLAN, subscriptionStatus: "PAST_DUE", tier: { code: "pro", name: "Pro" } },
      },
    ]);

    await show(worker);

    expect(text()).toContain("payment failed");
    expect(text()).toContain("Your payment didn’t go through");
    expect(text()).toContain("your plan is still Pro");
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

    expect(text()).toContain("Sign in");
    expect(container.querySelector(".popup-plan")).toBeNull();
    expect(text()).not.toContain("relists left");
    expect(text()).not.toContain("Free");
    expect(container.querySelector('[aria-label="Refresh"]')).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("signs in, then asks what the plan is", async () => {
    const { worker, asked } = fakeWorker([{ status: "signed-out" }, { status: "ready", plan: PLAN }]);

    await show(worker);
    await click("Sign in");

    expect(asked).toEqual(["display-state", "sign-in", "display-state", "list-ads"]);
    expect(text()).toContain("2 of 3 relists left");
  });

  it("says nothing when the user closed the window themselves", async () => {
    // They are already looking at the screen that says what to do about it.
    const { worker } = fakeWorker([{ status: "signed-out" }]);
    worker.signIn = vi.fn(async () => {
      throw new SignInCancelledError();
    });

    await show(worker);
    await click("Sign in");

    expect(text()).toContain("Sign in");
    expect(text()).not.toContain("cancelled");
    expect(container.querySelector(".mp-note")).toBeNull();
  });

  it("repeats Keycloak's own words when sign-in actually failed", async () => {
    const { worker } = fakeWorker([{ status: "signed-out" }]);
    worker.signIn = vi.fn(async () => {
      throw new SignInFailedError("Keycloak refused the sign-in: invalid_client");
    });

    await show(worker);
    await click("Sign in");

    expect(container.querySelector(".mp-note--error")?.textContent).toContain("invalid_client");
  });
});

describe("unavailable", () => {
  it("never shows a plan it could not confirm", async () => {
    // Fail-closed applies to display: the one thing this screen must not do is
    // draw a tier and a quota nobody answered with.
    const { worker } = fakeWorker([{ status: "unavailable" }]);

    await show(worker);

    expect(text()).toContain("Can’t reach");
    expect(text()).toContain("Nothing has been changed on Marktplaats");
    expect(text()).not.toContain("relists left");
  });

  it("recovers when the backend comes back", async () => {
    const { worker } = fakeWorker([{ status: "unavailable" }, { status: "ready", plan: PLAN }]);

    await show(worker);
    await click("Try again");

    expect(text()).toContain("2 of 3 relists left");
  });
});

describe("signing out", () => {
  it("goes straight back to the sign-in screen", async () => {
    const { worker, asked } = fakeWorker();

    await show(worker);
    await click("Sign out");

    expect(asked).toEqual(["display-state", "list-ads", "sign-out"]);
    expect(text()).toContain("Sign in");
    expect(text()).not.toContain("2 of 3 relists left");
  });

  it("still signs out when the worker could not finish the job", async () => {
    // Clearing the session is the worker's own first move (#32); a failure after
    // that must not leave a user looking at a plan they just left.
    const { worker } = fakeWorker();
    worker.signOut = vi.fn(async () => {
      throw new Error("the Keycloak session was not ended");
    });

    await show(worker);
    await click("Sign out");

    expect(text()).toContain("Sign in");
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
    await click("See plans");

    expect(asked).toEqual(["display-state", "list-ads", "plans"]);
    expect(text()).toContain("Choose a plan");
    expect(text()).toContain("50 relists a month");
  });

  it("and from the header, so somebody who is not out of relists can still reach them", async () => {
    // The canvas draws no way in but the prompt, which would leave a paying
    // subscriber unable to reach their own billing — and ADR-0017 makes this popup
    // the account surface.
    const { worker } = fakeWorker();

    await show(worker);
    await click("Plans");

    expect(text()).toContain("Choose a plan");
  });

  it("warn that Checkout takes over the screen, because it does", async () => {
    // The popup is destroyed the moment the tab takes focus (ADR-0017). A user who
    // is not told reads that as the click having failed.
    const { worker } = fakeWorker();

    await show(worker);
    await click("Plans");

    expect(text()).toContain("Checkout opens in a new tab");
    expect(text()).toContain("you drop back to Free, never locked out");
  });

  it("say what a buyer can pay with, before they leave for a page they have never seen", async () => {
    // The conversion point of T65 (#137): a Dutch buyer's question at this exact
    // moment is whether iDEAL is on the other side of that tab, and ADR-0006 chose
    // Stripe over a card-only arrangement to make sure it is. The default worker
    // answers `ideal, paypal, card`.
    const { worker } = fakeWorker();

    await show(worker);
    await click("Plans");

    expect(text()).toContain("Pay with iDEAL, PayPal or card");
  });

  it("and say nothing at all when Stripe could not be asked what they are", async () => {
    // The line degrades on its own. Every card, rhythm and amount is still here —
    // which is the whole reason `GET /api/plans` carries the methods beside the
    // plans rather than refusing both together.
    const { worker } = fakeWorker(undefined, ADS, {
      plans: { status: "ready", plans: [PRO, POWER], paymentMethods: [] },
    });

    await show(worker);
    await click("Plans");

    expect(text()).not.toContain("Pay with");
    expect(text()).toContain("Checkout opens in a new tab");
    expect(text()).toContain("9,99");
  });

  it("show the plan they are on beside the ones they could buy", async () => {
    const { worker } = fakeWorker();

    await show(worker);
    await click("Plans");

    expect(text()).toContain("Free");
    expect(text()).toContain("Your plan");
    expect(text()).toContain("Pro");
    expect(text()).toContain("Power");
  });

  it("go back to the ads without asking the backend anything again", async () => {
    // The plan and the ads are both still in hand; a reload here would be a
    // second answer to a question nobody asked twice.
    const { worker, asked } = fakeWorker();

    await show(worker);
    await click("Plans");
    await click("Back");

    expect(asked).toEqual(["display-state", "list-ads", "plans"]);
    expect(text()).toContain("2 of 3 relists left");
    expect(text()).not.toContain("Choose a plan");
  });

  it("say prices could not be loaded rather than showing a guessed one", async () => {
    const { worker } = fakeWorker(undefined, ADS, { plans: { status: "unavailable" } });

    await show(worker);
    await click("Plans");

    expect(text()).toContain("Prices couldn’t be loaded");
    expect(text()).not.toContain("Upgrade");
  });

  it("and ask again when told to", async () => {
    const { worker, asked } = fakeWorker(undefined, ADS, { plans: { status: "unavailable" } });

    await show(worker);
    await click("Plans");
    await click("Try again");

    expect(asked.filter((call) => call === "plans")).toHaveLength(2);
  });

  it("send somebody whose token expired back to the sign-in screen", async () => {
    // The ordinary way that happens is a popup left open. It is the same event
    // `/api/me` reports, so it gets the same screen rather than a note on this one.
    const { worker } = fakeWorker(undefined, ADS, { plans: { status: "signed-out" } });

    await show(worker);
    await click("Plans");

    expect(text()).toContain("Sign in");
    expect(text()).not.toContain("Choose a plan");
  });

  it("and a build the backend has stopped serving to the update screen", async () => {
    const { worker } = fakeWorker(undefined, ADS, { plans: { status: "outdated" } });

    await show(worker);
    await click("Plans");

    expect(text()).toContain("needs updating");
  });
});

describe("handing off to Stripe", () => {
  it("asks the worker to open Checkout for the tier and rhythm that was clicked", async () => {
    // The worker opens the tab, not this page: the tab takes focus and destroys
    // whoever asked, so a `chrome.tabs.create` awaited here would be awaited in a
    // page that no longer exists.
    const { worker, asked } = fakeWorker();

    await show(worker);
    await click("Plans");
    await click("€ 9,99 a month");

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
    await click("Plans");
    await click("€ 99,00 a year");

    expect(asked).toContain("checkout:pro:year");
    expect(asked).not.toContain("checkout:pro:month");
  });

  it("says a plan is no longer on sale rather than that something broke", async () => {
    // What a client holding yesterday's cards gets, and nobody's error.
    const { worker } = fakeWorker(undefined, ADS, { checkout: { status: "gone" } });

    await show(worker);
    await click("Plans");
    await click("€ 9,99 a month");

    expect(text()).toContain("isn’t on sale any more");
  });

  it("and says come back in a moment when Stripe could not be asked", async () => {
    const { worker } = fakeWorker(undefined, ADS, { checkout: { status: "unavailable" } });

    await show(worker);
    await click("Plans");
    await click("€ 9,99 a month");

    expect(text()).toContain("Checkout couldn’t be opened");
  });

  it("opens the Customer Portal from the plans screen", async () => {
    const { worker, asked } = fakeWorker();

    await show(worker);
    await click("Plans");
    await click("Manage billing");

    expect(asked).toContain("portal");
  });

  it("and tells somebody who has never paid that there is nothing there", async () => {
    // Every free user who has not bought anything, which is most accounts — so it
    // is a sentence rather than an apology.
    const { worker } = fakeWorker(undefined, ADS, { portal: { status: "gone" } });

    await show(worker);
    await click("Plans");
    await click("Manage billing");

    expect(text()).toContain("nothing to manage");
  });

  it("offers the Portal beside a failing card, which is where ADR-0018 puts it", async () => {
    // The 402 copy is "update your card", not "resubscribe" — nothing has been
    // cancelled, Stripe is still retrying, and the tier is still theirs.
    const failing: DisplayState = { ...PLAN, subscriptionStatus: "PAST_DUE", tier: { code: "pro", name: "Pro" } };
    const { worker, asked } = fakeWorker([{ status: "ready", plan: failing }]);

    await show(worker);
    expect(text()).toContain("Your payment didn’t go through");
    await click("Update card");

    expect(asked).toContain("portal");
  });

  it("and says so on that prompt when the Portal could not be opened", async () => {
    const failing: DisplayState = { ...PLAN, subscriptionStatus: "PAST_DUE", tier: { code: "pro", name: "Pro" } };
    const { worker } = fakeWorker([{ status: "ready", plan: failing }], ADS, {
      portal: { status: "unavailable" },
    });

    await show(worker);
    await click("Update card");

    expect(text()).toContain("billing page couldn’t be opened");
    // And the plan is still theirs: a failed hand-off changes nothing about it.
    expect(text()).toContain("Pro");
  });
});
