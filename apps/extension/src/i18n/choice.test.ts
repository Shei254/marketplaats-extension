import type { Language } from "@mprelist/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { chooseLanguage, followLanguage, LANGUAGE_KEY, type LanguageSource } from "./choice";
import { language, words } from "./words";

type Listener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => void;

function source(stored: Record<string, unknown> = {}, browserList: string[] = ["nl-NL"]) {
  const area: Record<string, unknown> = { ...stored };
  const listeners: Listener[] = [];
  const shown: Language[] = [];
  const fake: LanguageSource & { area: Record<string, unknown>; fire: Listener } = {
    area,
    storage: {
      get: async (key: string) => (key in area ? { [key]: area[key] } : {}),
      set: async (items: Record<string, unknown>) => {
        Object.assign(area, items);
      },
    },
    onChanged: { addListener: (listener) => void listeners.push(listener) },
    browserList: () => browserList,
    apply: (chosen) => void shown.push(chosen),
    fire: (changes, areaName) => listeners.forEach((listener) => listener(changes, areaName)),
  };
  return { ...fake, shown };
}

describe("the extension's Language (T97)", () => {
  it("follows the browser's list while nothing is chosen", async () => {
    const english = source({}, ["en-US", "nl"]);
    await followLanguage(english);
    expect(english.shown).toEqual(["en"]);
  });

  it("is the stored choice whenever there is one", async () => {
    const chosen = source({ [LANGUAGE_KEY]: "nl" }, ["en-GB"]);
    await followLanguage(chosen);
    expect(chosen.shown).toEqual(["nl"]);
  });

  it("is the browser's for a stored value that is not a Language", async () => {
    const odd = source({ [LANGUAGE_KEY]: "EN" }, ["en"]);
    await followLanguage(odd);
    expect(odd.shown).toEqual(["en"]);
  });

  it("is the browser's when storage cannot be read", async () => {
    const refusing = source({}, ["en"]);
    refusing.storage.get = () => Promise.reject(new Error("no storage"));
    await followLanguage(refusing);
    expect(refusing.shown).toEqual(["en"]);
  });

  it("follows a choice made in another context — the popup's, seen by the Page button and the worker", async () => {
    const page = source();
    await followLanguage(page);
    page.fire({ [LANGUAGE_KEY]: { newValue: "en" } }, "local");
    expect(page.shown).toEqual(["nl", "en"]);
  });

  it("ignores every other key and every other area", async () => {
    const page = source();
    await followLanguage(page);
    page.fire({ "mprelist.session": { newValue: "en" } }, "local");
    page.fire({ [LANGUAGE_KEY]: { newValue: "en" } }, "session");
    expect(page.shown).toEqual(["nl"]);
  });

  it("goes back to the browser's list when the choice is removed", async () => {
    const page = source({ [LANGUAGE_KEY]: "nl" }, ["en"]);
    await followLanguage(page);
    page.fire({ [LANGUAGE_KEY]: {} }, "local");
    expect(page.shown).toEqual(["nl", "en"]);
  });

  it("listens before it has read, so a choice made meanwhile is not missed", async () => {
    const page = source();
    let answer: (value: Record<string, unknown>) => void = () => {};
    page.storage.get = () => new Promise((resolve) => (answer = resolve));
    const following = followLanguage(page);
    page.fire({ [LANGUAGE_KEY]: { newValue: "en" } }, "local");
    answer({});
    await following;
    expect(page.shown.at(-1)).toBe("en");
  });
});

describe("pressing the switch", () => {
  it("shows the Language at once and keeps it where every context reads it", async () => {
    const popup = source();
    await chooseLanguage("en", popup);
    expect(popup.shown).toEqual(["en"]);
    expect(popup.area[LANGUAGE_KEY]).toBe("en");
  });

  it("still changes this popup when storage refuses the write", async () => {
    const popup = source();
    popup.storage.set = () => Promise.reject(new Error("quota"));
    await chooseLanguage("en", popup);
    expect(popup.shown).toEqual(["en"]);
  });
});

describe("the Language applied to the extension's words", () => {
  afterEach(() => void words.changeLanguage("nl"));

  it("is what every sentence and every hand-off reads next", async () => {
    const english = source({}, ["en"]);
    delete (english as Partial<LanguageSource>).apply;
    await followLanguage(english);
    expect(language()).toBe("en");
    expect(words.t("header.signOut")).toBe("Sign out");
  });
});
