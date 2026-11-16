import { afterEach, describe, expect, it } from "vitest";

import { arriving, chooseLanguage, LANGUAGE_KEY, type LanguageStore } from "./choice";
import { language, words } from "./words";

function store(initial: Record<string, string> = {}): LanguageStore & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

const refusing: LanguageStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("the site's Language on arrival (T97)", () => {
  it("follows the browser's list while nothing is chosen", () => {
    expect(arriving({ search: "", store: store(), browserList: ["en-US"] }).language).toBe("en");
    expect(arriving({ search: "", store: store(), browserList: ["de"] }).language).toBe("nl");
  });

  it("is the stored choice whenever there is one", () => {
    const chosen = store({ [LANGUAGE_KEY]: "nl" });
    expect(arriving({ search: "", store: chosen, browserList: ["en"] }).language).toBe("nl");
  });

  it("is set by `?lang` on an incoming link — the popup's hand-off — which is kept as the choice", () => {
    const kept = store({ [LANGUAGE_KEY]: "nl" });
    expect(arriving({ search: "?lang=en", store: kept, browserList: ["nl"] }).language).toBe("en");
    expect(kept.values[LANGUAGE_KEY]).toBe("en");
  });

  it("takes `?lang` out of the address, and leaves everything else in it", () => {
    expect(arriving({ search: "?lang=en", store: store(), browserList: [] }).search).toBe("");
    expect(arriving({ search: "?code=abc&lang=en&state=x", store: store(), browserList: [] }).search).toBe(
      "?code=abc&state=x",
    );
    expect(arriving({ search: "?code=abc", store: store(), browserList: [] }).search).toBe("?code=abc");
  });

  it("ignores a `?lang` that is not a Language, and still takes it out", () => {
    const kept = store();
    const arrival = arriving({ search: "?lang=de", store: kept, browserList: ["en"] });
    expect(arrival).toEqual({ language: "en", search: "" });
    expect(kept.values).toEqual({});
  });

  it("is the browser's, or the link's, when storage is blocked", () => {
    expect(arriving({ search: "", store: refusing, browserList: ["en"] }).language).toBe("en");
    expect(arriving({ search: "?lang=nl", store: refusing, browserList: ["en"] }).language).toBe("nl");
    expect(arriving({ search: "", store: undefined, browserList: ["en"] }).language).toBe("en");
  });
});

describe("pressing the site's switch", () => {
  afterEach(() => void words.changeLanguage("nl"));

  it("changes every sentence on the site and keeps the choice", () => {
    const kept = store();
    chooseLanguage("en", kept);
    expect(language()).toBe("en");
    expect(words.t("nav.terms")).toBe("Terms");
    expect(kept.values[LANGUAGE_KEY]).toBe("en");
  });

  it("still changes the page when storage refuses the write", () => {
    chooseLanguage("en", refusing);
    expect(language()).toBe("en");
  });
});
