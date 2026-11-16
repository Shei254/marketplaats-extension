import { keyPaths } from "@mprelist/contracts";
import { describe, expect, it } from "vitest";

import { en } from "./en";
import { nl } from "./nl";
import { language, onTheSite, words } from "./words";

describe("the extension's English", () => {
  it("has exactly the Dutch catalog's keys", () => {
    expect(keyPaths(en)).toEqual(keyPaths(nl));
  });

  it("says repost for herplaatsen, and leaves Marktplaats's own labels as Marktplaats writes them", () => {
    expect(en.repost.label.idle).toBe("Repost");
    expect(en.ads.reserved).toBe(nl.ads.reserved);
    expect(en.ads.bid).toBe(nl.ads.bid);
    expect(en.ads.free).toBe(nl.ads.free);
    expect(en.ads.seeDescription).toBe(nl.ads.seeDescription);
  });

  it("is bundled but not shown: every build is still Dutch (T97 turns it on)", () => {
    expect(language()).toBe("nl");
    expect(words.t("repost.label.idle")).toBe("Herplaats");
    expect(words.getFixedT("en")("repost.label.idle")).toBe("Repost");
  });
});

describe("a link to the site", () => {
  it("carries the Language as `?lang`, ahead of any fragment", () => {
    expect(onTheSite("https://www.example.test/#abonnementen")).toBe(
      "https://www.example.test/?lang=nl#abonnementen",
    );
  });
});
