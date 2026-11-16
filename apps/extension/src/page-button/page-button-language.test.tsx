// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { LANGUAGE_KEY } from "../i18n/choice";
import { rowHtml } from "./testing/row";

/**
 * The **Page button** has no Language switch of its own (ADR-0043): it follows
 * the popup's, which reaches this content script as a `chrome.storage` change.
 * Through the real entry, in a file of its own so that no other test's copy of
 * the entry is still drawing on the same page.
 */
type StorageListener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => void;
const storageListeners: StorageListener[] = [];

(globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
(globalThis as Record<string, unknown>).chrome = {
  storage: {
    // Chosen Dutch, against happy-dom's English browser list.
    local: { get: async () => ({ [LANGUAGE_KEY]: "nl" }), set: async () => {} },
    onChanged: { addListener: (listener: StorageListener) => void storageListeners.push(listener) },
  },
  runtime: {
    sendMessage: vi.fn(async (request: { kind: string }) =>
      request.kind === "display-state"
        ? { ok: true, answer: { status: "unavailable" } }
        : { ok: true, answer: request.kind === "relist-status" ? null : 0 },
    ),
  },
};

const labels = () =>
  [...document.querySelectorAll("[data-adbump-page-button]")]
    .flatMap((host) => [...(host.shadowRoot?.querySelectorAll("button") ?? [])])
    .map((button) => button.textContent)
    .join(" | ");

describe("the Page button's Language (T97)", () => {
  it("re-labels when the popup's Language changes, with no reload", async () => {
    document.body.innerHTML = rowHtml("m1");
    await act(async () => {
      await import("./page-button-entry");
    });
    expect(labels()).toContain("Herplaats");

    await act(async () => {
      storageListeners.forEach((listener) => listener({ [LANGUAGE_KEY]: { newValue: "en" } }, "local"));
    });
    expect(labels()).toContain("Repost");
    expect(labels()).not.toContain("Herplaats");
  });
});
