import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installChromeStub, type ChromeStub } from "../testing/chrome-stub";
import { fromWireError, toWireError, type RelayRequest, type RelayResponse } from "../content/messages";
import {
  ApiRequestError,
  NoMarktplaatsTabError,
  RelayMarktplaatsClient,
  StaleMarktplaatsTabError,
} from "./relay-marktplaats-client";

/**
 * Which marktplaats.nl tab the relay talks through (ADR-0039). A **Stale tab** —
 * open since before the extension was installed, updated or re-enabled — has no
 * content script, and Chrome says so in one English sentence.
 */

const NO_RECEIVER = "Could not establish connection. Receiving end does not exist.";

type Tab = { id: number; answer: RelayResponse | "stale" };

let chrome: ChromeStub;
let sent: number[];

function withTabs(tabs: Tab[]): void {
  sent = [];
  (globalThis as { chrome: Record<string, unknown> }).chrome.tabs = {
    query: async () => tabs.map(({ id }) => ({ id })),
    sendMessage: async (tabId: number, _request: RelayRequest) => {
      sent.push(tabId);
      const answer = tabs.find((tab) => tab.id === tabId)!.answer;
      if (answer === "stale") throw new Error(NO_RECEIVER);
      return answer;
    },
  };
}

beforeEach(() => {
  chrome = installChromeStub();
});

afterEach(() => chrome.restore());

describe("the tab a request goes through", () => {
  it("is the first that answers, when an earlier one is stale", async () => {
    withTabs([
      { id: 1, answer: "stale" },
      { id: 2, answer: { ok: true, value: [] } },
    ]);

    await expect(new RelayMarktplaatsClient().listMyAds()).resolves.toEqual([]);
    expect(sent).toEqual([1, 2]);
  });

  it("is none when every one is stale, and the error names the first to reload", async () => {
    withTabs([
      { id: 7, answer: "stale" },
      { id: 8, answer: "stale" },
    ]);

    const failure = await new RelayMarktplaatsClient().listMyAds().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(StaleMarktplaatsTabError);
    expect((failure as StaleMarktplaatsTabError).tabId).toBe(7);
  });

  it("is none when no marktplaats.nl tab is open", async () => {
    withTabs([]);

    await expect(new RelayMarktplaatsClient().listMyAds()).rejects.toBeInstanceOf(NoMarktplaatsTabError);
  });

  it("is never a second one after the first has answered, even with a failure", async () => {
    // A delete or a create that failed in one tab must not be sent again from
    // another — the first may have done it.
    withTabs([
      { id: 1, answer: { ok: false, error: { code: "API_ERROR", message: "no", status: 500, body: "" } } },
      { id: 2, answer: { ok: true, value: null } },
    ]);

    await expect(new RelayMarktplaatsClient().deleteAd("ad-1")).rejects.toBeInstanceOf(ApiRequestError);
    expect(sent).toEqual([1]);
  });
});

describe("a stale tab crossing into the popup", () => {
  it("is still stale on the other side, and still names its tab", () => {
    const rebuilt = fromWireError(toWireError(new StaleMarktplaatsTabError(7)));

    expect(rebuilt).toBeInstanceOf(StaleMarktplaatsTabError);
    expect((rebuilt as StaleMarktplaatsTabError).tabId).toBe(7);
  });
});
