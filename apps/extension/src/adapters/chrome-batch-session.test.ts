import { afterEach, describe, expect, it } from "vitest";

import { installChromeStub, type ChromeStub } from "../testing/chrome-stub";
import { ChromeBatchSession } from "./chrome-batch-session";

/**
 * The marker that tells a browser which has just started from one that has been
 * running all day (T68, #147; ADR-0025).
 *
 * **It is the whole of the restart rule in practice.** The runner drops a live run
 * on the first wake of a session, and this is the only thing that says which wake
 * that is — a wrong answer either way is a real failure: `true` too often drops
 * runs that were only being advanced, and `true` too rarely lets a queue from
 * yesterday delete an ad nobody is thinking about.
 */
describe("the first wake of a browser session", () => {
  let chrome: ChromeStub | null = null;

  afterEach(() => {
    chrome?.restore();
    chrome = null;
  });

  it("is claimed once, and every wake after it is an ordinary one", async () => {
    chrome = installChromeStub();
    const session = new ChromeBatchSession();

    expect(await session.claimFirstWake()).toBe(true);
    expect(await session.claimFirstWake()).toBe(false);
    expect(await session.claimFirstWake()).toBe(false);
  });

  // A fresh instance is what every wake really has: the worker is torn down about
  // thirty seconds after it goes idle, so the memory cannot be in the object.
  it("and a worker that has been evicted and rebuilt still knows", async () => {
    chrome = installChromeStub();
    await new ChromeBatchSession().claimFirstWake();

    expect(await new ChromeBatchSession().claimFirstWake()).toBe(false);
  });

  /**
   * The point of the session area, asserted rather than assumed: `local` outlives
   * the browser, so a marker written there would make the *second* browser session
   * look like a continuation of the first — and the run from yesterday would be
   * picked up rather than dropped.
   */
  it("and is forgotten when the browser is, which is what makes it the answer", async () => {
    chrome = installChromeStub();
    await new ChromeBatchSession().claimFirstWake();
    expect(chrome.area).toEqual({});

    // What Chrome does to the session area when it closes.
    for (const key of Object.keys(chrome.session)) delete chrome.session[key];

    expect(await new ChromeBatchSession().claimFirstWake()).toBe(true);
  });
});
