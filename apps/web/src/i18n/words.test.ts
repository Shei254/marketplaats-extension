import { keyPaths } from "@mprelist/contracts";
import { describe, expect, it } from "vitest";

import { en } from "./en";
import { nl } from "./nl";
import { language, words } from "./words";

describe("the site's English", () => {
  it("has exactly the Dutch catalog's keys, the two legal documents paragraph for paragraph", () => {
    expect(keyPaths(en)).toEqual(keyPaths(nl));
  });

  it("says repost for herplaatsen", () => {
    expect(en.landing.steps.repost.title).toBe("Click <b>Repost</b>");
  });

  it("gives neither legal document a line about which language governs", () => {
    // Equal standing (ADR-0043): no sentence in either says one of them wins.
    // Such a line names a language, or a translation, or one version prevailing.
    const said = JSON.stringify([en.privacy, en.terms, nl.privacy, nl.terms]);
    expect(said).not.toMatch(
      /\b(language|translation|translated|prevails?|English|Engels|taal|talen|vertaling|vertaald|prevaleert|Nederlands|Dutch)\b/i,
    );
  });

  it("is bundled but not shown: the site is still Dutch (T97 turns it on)", () => {
    expect(language()).toBe("nl");
    expect(words.t("nav.signIn")).toBe("Inloggen");
    expect(words.getFixedT("en")("nav.signIn")).toBe("Sign in");
  });
});
