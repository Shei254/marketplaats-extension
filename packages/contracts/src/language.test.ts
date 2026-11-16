import { describe, expect, it } from "vitest";

import { asLanguage, DUTCH, LANGUAGE_NAMES, languageFor, languageOnScreen, otherLanguage } from "./language";

describe("the Language a browser's list asks for", () => {
  it("is whichever of Dutch or English the list names first", () => {
    expect(languageFor(["pl", "en-US", "nl"])).toBe("en");
    expect(languageFor(["de", "nl-BE", "en"])).toBe("nl");
  });

  it("is Dutch for a list that names neither, and for no list at all", () => {
    expect(languageFor(["de-DE", "fr"])).toBe(DUTCH);
    expect(languageFor([])).toBe(DUTCH);
  });

  it("reads a tag by its language, whatever the region or the case", () => {
    expect(languageFor(["EN-gb"])).toBe("en");
    expect(languageFor(["nl-NL"])).toBe("nl");
  });

  it("does not take a longer tag for one of ours", () => {
    // `nlx` and `eng` are not Dutch and English with a region; they are other tags.
    expect(languageFor(["eng", "nlx"])).toBe(DUTCH);
  });
});

describe("a value read back as a Language", () => {
  it("is one of ours only when it is spelled exactly as one", () => {
    expect(asLanguage("nl")).toBe("nl");
    expect(asLanguage("en")).toBe("en");
  });

  it("is nothing for anything else, so a stored oddity is no choice at all", () => {
    for (const value of ["EN", "en-GB", "de", "", null, undefined, 1, {}]) expect(asLanguage(value)).toBeNull();
  });
});

describe("the Language on screen (T97)", () => {
  it("is the choice whenever one was made, whatever the browser asks for", () => {
    expect(languageOnScreen("en", ["nl-NL"])).toBe("en");
    expect(languageOnScreen("nl", ["en-US"])).toBe("nl");
  });

  it("follows the browser's list while nothing is chosen", () => {
    expect(languageOnScreen(null, ["en-US", "nl"])).toBe("en");
    expect(languageOnScreen(null, ["de"])).toBe(DUTCH);
  });
});

describe("the switch between the two", () => {
  it("leads to the other one", () => {
    expect(otherLanguage("nl")).toBe("en");
    expect(otherLanguage("en")).toBe("nl");
  });

  it("names each in itself, the same in either Language", () => {
    expect(LANGUAGE_NAMES).toEqual({ nl: "Nederlands", en: "English" });
  });
});
