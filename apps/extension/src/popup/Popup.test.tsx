// @vitest-environment happy-dom
import type { DisplayState } from "@mprelist/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DisplayStateAnswer } from "../api/display-state";
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

export const ADS: ListingSummary[] = [
  { id: "m1", title: "Vintage Eames lounge chair", priceCents: 125_000 },
  { id: "m2", title: "Trek Marlin 7 mountainbike (M)", priceCents: 48_000 },
];

function fakeWorker(answers: DisplayStateAnswer[] = [{ status: "ready", plan: PLAN }], ads: ListingSummary[] = ADS) {
  const asked: string[] = [];
  const queue = [...answers];
  const worker: WorkerPort = {
    displayState: vi.fn(async () => {
      asked.push("display-state");
      return queue.length > 1 ? (queue.shift() as DisplayStateAnswer) : (queue[0] as DisplayStateAnswer);
    }),
    ads: vi.fn(async () => {
      asked.push("list-ads");
      return ads;
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
    signIn: vi.fn(async () => {
      asked.push("sign-in");
    }),
    signOut: vi.fn(async () => {
      asked.push("sign-out");
    }),
  };
  return { worker, asked };
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

function click(label: string): Promise<void> {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (!button) throw new Error(`no button labelled ${label} — screen reads: ${text()}`);
  return act(async () => {
    button.click();
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
