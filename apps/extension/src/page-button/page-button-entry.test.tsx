// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rowHtml } from "./testing/row";

/**
 * ADR-0007 through the real entry: signed out, nothing is injected into
 * marktplaats.nl; signing in draws the buttons without a reload.
 */
let answer: { status: string; plan?: unknown } = { status: "signed-out" };

beforeEach(() => {
  (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
  document.body.innerHTML = rowHtml("m1");
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      sendMessage: vi.fn(async (request: { kind: string }) =>
        request.kind === "display-state"
          ? { ok: true, answer }
          : { ok: true, answer: request.kind === "relist-status" ? null : 0 },
      ),
    },
  };
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.resetModules();
});

const ours = () => document.querySelectorAll("[data-adbump-page-button]").length;

describe("the Page button's content script", () => {
  it("draws nothing for a signed-out seller, and draws once they sign in", async () => {
    answer = { status: "signed-out" };
    await act(async () => {
      await import("./page-button-entry");
    });
    expect(ours()).toBe(0);

    answer = { status: "unavailable" };
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(ours()).toBeGreaterThan(0);
  });
});
