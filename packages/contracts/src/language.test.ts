import { describe, expect, it } from "vitest";

import { DUTCH, languageFor } from "./language";

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
